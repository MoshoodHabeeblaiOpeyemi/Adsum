const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");

try {
  if (getApps().length === 0) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
} catch (e) { if (!/already exists/.test(e.message)) console.error("Init error:", e); }

const db = getFirestore();
const norm = (v) => String(v || "").trim().toUpperCase();

// Firestore document IDs cannot contain "/", but matric numbers often do
// (e.g. 24/56SV002) — that used to crash the hotspot grant with "Document
// IDs must not contain '/'". Percent-encode the illegal characters the same
// way course.js encodes matricRegistry keys, so the mapping is reversible
// and no two matrics can ever collapse into the same hotspotLog doc.
const escKeyPart = (v) =>
  String(v || "")
    .trim()
    .toUpperCase()
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/\|/g, "%7C");

async function handleApproveManual(req, res, decoded) {
  try {
    const { courseId, targetUid } = req.body || {};
    if (!courseId || !targetUid) return res.status(400).json({ error: "Course ID and target UID are required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const memberSnap = await courseRef.collection("members").doc(decoded.uid).get();
    const isRep = courseData.repUid === decoded.uid;
    const isAssistant = memberSnap.exists && (memberSnap.data().role === "assistant" || memberSnap.data().role === "session_assistant");
    if (!isRep && !isAssistant) return res.status(403).json({ error: "Only course staff can approve requests." });

    const requestRef = courseRef.collection("manualRequests").doc(targetUid);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) return res.status(404).json({ error: "No manual request found for this student." });

    const request = requestSnap.data();
    const liveRef = courseRef.collection("session").doc("live");
    const liveSnap = await liveRef.get();
    if (!liveSnap.exists) return res.status(403).json({ error: "No live session." });

    const live = liveSnap.data();
    if (request.sessionExpiresAt !== live.expiresAt) return res.status(409).json({ error: "This request is for a different session. Cross-session approval is not allowed." });

    const secretRef = courseRef.collection("session").doc("secret");
    const targetUserSnap = await db.collection("users").doc(targetUid).get();
    if (!targetUserSnap.exists) return res.status(404).json({ error: "Target user not found." });
    const targetMatric = norm(targetUserSnap.data().matric);

    // Re-seed the rep into the course-doc union too (same convergence as the
    // scan path — the course doc can lose the rep through publish/merge races).
    const secretSnap = await secretRef.get();
    const managerMatric = secretSnap.exists
      ? secretSnap.data().managerMatric || ""
      : "";

    await db.runTransaction(async (tx) => {
      // Mirror into the course doc's activeSession too, so the newly approved
      // student shows up on everyone's Live Attendance roster instantly.
      // Null-guarded like the check-in publish: if no activeSession map has
      // been published yet, skip — the roster catches up on the next event.
      const courseTxnSnap = await tx.get(courseRef);
      const liveSession = courseTxnSnap.exists ? courseTxnSnap.data().activeSession : null;
      if (liveSession && typeof liveSession === "object") {
        // Union the approved student AND re-seed the rep so the newly approved
        // student appears (and the rep stays) on everyone's Live roster.
        tx.update(courseRef, {
          "activeSession.attendees": managerMatric
            ? FieldValue.arrayUnion(targetMatric, managerMatric)
            : FieldValue.arrayUnion(targetMatric),
        });
      }
      tx.update(secretRef, { attendees: FieldValue.arrayUnion(targetMatric) });
      tx.update(requestRef, { status: "approved", approvedBy: decoded.uid, approvedAt: FieldValue.serverTimestamp() });
    });

    return res.status(200).json({ success: true, message: "Request approved." });
  } catch (error) {
    console.error("Approve manual error:", error);
    return res.status(500).json({ error: "Unable to approve the request. Please try again." });
  }
}

async function handleGrantHotspot(req, res, decoded) {
  try {
    const { courseId, targetMatric } = req.body || {};
    if (!courseId || !targetMatric) return res.status(400).json({ error: "Course ID and target matric are required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const memberSnap = await courseRef.collection("members").doc(decoded.uid).get();
    const isRep = courseData.repUid === decoded.uid;
    if (!isRep) return res.status(403).json({ error: "Only the course rep can grant hotspot access." });

    const liveSnap = await courseRef.collection("session").doc("live").get();
    if (!liveSnap.exists) return res.status(403).json({ error: "No live session." });

    const live = liveSnap.data();
    const secretSnap = await courseRef.collection("session").doc("secret").get();
    const secret = secretSnap.data();
    const normalizedTarget = norm(targetMatric);

    if (!(secret.attendees || []).includes(normalizedTarget)) return res.status(403).json({ error: "Target student has not checked in yet." });

    const rlCount = await courseRef.collection("hotspotLog").where("sessionExpiresAt", "==", live.expiresAt).count().get();
    if (rlCount.data().count >= 5) return res.status(403).json({ error: "Hotspot limit reached (max 5 per session)." });

    const targetMemberSnap = await courseRef.collection("members").where("matric", "==", normalizedTarget).limit(1).get();
    if (targetMemberSnap.empty) return res.status(404).json({ error: "Student not found in this course." });

    const targetUid = targetMemberSnap.docs[0].id;
    const rlRef = courseRef
      .collection("hotspotLog")
      .doc(`${escKeyPart(normalizedTarget)}_${live.expiresAt}`);

    // Granter identity is read OUTSIDE the transaction — plain reads inside a
    // tx block give no consistency guarantee across transaction retries.
    const granterSnap = await db.collection("users").doc(decoded.uid).get();
    const granterMatric = granterSnap.exists ? norm(granterSnap.data().matric) || "rep" : "rep";

    await db.runTransaction(async (tx) => {
      tx.update(courseRef.collection("members").doc(targetUid), { role: "session_assistant" });
      tx.update(courseRef, { assistants: FieldValue.arrayUnion(normalizedTarget) });
      tx.set(rlRef, { matric: normalizedTarget, grantedByMatric: granterMatric, sessionExpiresAt: live.expiresAt, grantedAt: FieldValue.serverTimestamp() });
    });

    return res.status(200).json({ success: true, message: `${normalizedTarget} granted hotspot access.` });
  } catch (error) {
    console.error("Grant hotspot error:", error);
    return res.status(500).json({ error: "Unable to grant hotspot power. Please try again." });
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    await verifyAppCheck(req);
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAuth().verifyIdToken(header.slice(7));
    const action = req.query.action;
    switch (action) {
      case "approveManual": return handleApproveManual(req, res, decoded);
      case "grantHotspot": return handleGrantHotspot(req, res, decoded);
      default: return res.status(400).json({ error: "Invalid action. Use: approveManual, grantHotspot" });
    }
  } catch (error) {
    console.error("Approval API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
