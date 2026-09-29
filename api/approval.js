const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");
const { WINDOW_MS } = require("../utils/throttle");

try {
  if (getApps().length === 0)
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(
          /\\n/g,
          "\n",
        ),
      }),
    });
} catch (e) {
  if (!/already exists/.test(e.message)) console.error("Init error:", e);
}

const db = getFirestore();
const norm = (v) =>
  String(v || "")
    .trim()
    .toUpperCase();

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

async function handleRequestManual(req, res, decoded) {
  try {
    const { courseId, reason } = req.body || {};
    if (typeof courseId !== "string" || !courseId)
      return res.status(400).json({ error: "Course ID is required." });
    if (
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.trim().length > 200
    )
      return res
        .status(400)
        .json({ error: "Enter a reason of 1 to 200 characters." });

    const courseRef = db.collection("courses").doc(courseId);
    const memberRef = courseRef.collection("members").doc(decoded.uid);
    const liveRef = courseRef.collection("session").doc("live");
    const profileRef = db.collection("users").doc(decoded.uid);
    const failuresRef = db
      .collection("pinAttempts")
      .doc(`${decoded.uid}_${courseId}`);
    const requestRef = courseRef.collection("manualRequests").doc(decoded.uid);
    const now = Date.now();

    try {
      await db.runTransaction(async (tx) => {
        const [
          courseSnap,
          memberSnap,
          liveSnap,
          profileSnap,
          failuresSnap,
          requestSnap,
        ] = await Promise.all([
          tx.get(courseRef),
          tx.get(memberRef),
          tx.get(liveRef),
          tx.get(profileRef),
          tx.get(failuresRef),
          tx.get(requestRef),
        ]);
        if (!courseSnap.exists || !memberSnap.exists)
          throw new Error("NOT_ENROLLED");
        if (
          !liveSnap.exists ||
          !Number.isFinite(liveSnap.data().expiresAt) ||
          now > liveSnap.data().expiresAt
        )
          throw new Error("NO_LIVE_SESSION");
        if (!profileSnap.exists) throw new Error("PROFILE_NOT_FOUND");

        const sessionExpiresAt = liveSnap.data().expiresAt;
        const failures = failuresSnap.exists ? failuresSnap.data() : {};
        const lastAttempt = Number(failures.lastAttempt || 0);
        if (
          failures.sessionExpiresAt !== sessionExpiresAt ||
          Number(failures.count || 0) < 3 ||
          now - lastAttempt > WINDOW_MS
        )
          throw new Error("TOO_FEW_FAILURES");

        if (
          requestSnap.exists &&
          requestSnap.data().sessionExpiresAt === sessionExpiresAt
        )
          throw new Error(
            requestSnap.data().status === "pending"
              ? "REQUEST_PENDING"
              : "REQUEST_RESOLVED",
          );

        const profile = profileSnap.data();
        tx.set(requestRef, {
          uid: decoded.uid,
          name: String(profile.name || "Student").slice(0, 120),
          matric: String(memberSnap.data().matric || profile.matric || "")
            .trim()
            .toUpperCase(),
          reason: reason.trim(),
          status: "pending",
          sessionExpiresAt,
          requestedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      const responses = {
        NOT_ENROLLED: [403, "You are no longer enrolled in this course."],
        NO_LIVE_SESSION: [409, "There is no active session for this request."],
        PROFILE_NOT_FOUND: [404, "User profile not found."],
        TOO_FEW_FAILURES: [
          403,
          "Manual verification unlocks after three failed check-ins in this session.",
        ],
        REQUEST_PENDING: [
          409,
          "You already have a pending request for this session.",
        ],
        REQUEST_RESOLVED: [
          409,
          "Your request has already been resolved for this session.",
        ],
      };
      const response = responses[error.message];
      if (response) return res.status(response[0]).json({ error: response[1] });
      throw error;
    }

    return res.status(200).json({ success: true, message: "Request sent." });
  } catch (error) {
    console.error("Request manual verification error:", error);
    return res
      .status(500)
      .json({ error: "Unable to send your request. Please try again." });
  }
}

async function handleApproveManual(req, res, decoded) {
  try {
    const { courseId, targetUid } = req.body || {};
    if (!courseId || !targetUid)
      return res
        .status(400)
        .json({ error: "Course ID and target UID are required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists)
      return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const staffMember = await courseRef
      .collection("members")
      .doc(decoded.uid)
      .get();
    const isRep = courseData.repUid === decoded.uid;
    const isAssistant =
      staffMember.exists &&
      ["assistant", "session_assistant"].includes(staffMember.data().role);
    if (!isRep && !isAssistant)
      return res
        .status(403)
        .json({ error: "Only course staff can approve requests." });
    if (targetUid === decoded.uid)
      return res
        .status(403)
        .json({ error: "You cannot approve your own request." });

    const requestRef = courseRef.collection("manualRequests").doc(targetUid);
    const liveRef = courseRef.collection("session").doc("live");
    const secretRef = courseRef.collection("session").doc("secret");
    const targetMemberRef = courseRef.collection("members").doc(targetUid);

    try {
      await db.runTransaction(async (tx) => {
        const [
          requestSnap,
          liveSnap,
          secretSnap,
          targetMemberSnap,
          currentCourseSnap,
        ] = await Promise.all([
          tx.get(requestRef),
          tx.get(liveRef),
          tx.get(secretRef),
          tx.get(targetMemberRef),
          tx.get(courseRef),
        ]);
        if (!requestSnap.exists) throw new Error("NO_MANUAL_REQUEST");
        if (!liveSnap.exists || !secretSnap.exists)
          throw new Error("NO_LIVE_SESSION");
        if (!targetMemberSnap.exists) throw new Error("TARGET_NOT_ENROLLED");

        const request = requestSnap.data();
        const live = liveSnap.data();
        const targetMatric = norm(targetMemberSnap.data().matric);
        const secret = secretSnap.data();
        if (request.status !== "pending" || request.uid !== targetUid)
          throw new Error("REQUEST_ALREADY_RESOLVED");
        if (request.sessionExpiresAt !== live.expiresAt)
          throw new Error("REQUEST_SESSION_MISMATCH");
        if (!targetMatric || (secret.attendees || []).includes(targetMatric))
          throw new Error("ALREADY_CHECKED_IN");

        const managerMatric = secret.managerMatric || "";
        const activeSession = currentCourseSnap.exists
          ? currentCourseSnap.data().activeSession
          : null;
        if (activeSession && typeof activeSession === "object") {
          tx.update(courseRef, {
            "activeSession.attendees": managerMatric
              ? FieldValue.arrayUnion(targetMatric, managerMatric)
              : FieldValue.arrayUnion(targetMatric),
          });
        }
        tx.update(secretRef, {
          attendees: FieldValue.arrayUnion(targetMatric),
        });
        tx.update(requestRef, {
          status: "approved",
          approvedBy: decoded.uid,
          approvedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      const knownErrors = {
        NO_MANUAL_REQUEST: [404, "No manual request found for this student."],
        NO_LIVE_SESSION: [403, "No live session."],
        TARGET_NOT_ENROLLED: [
          404,
          "This student is no longer enrolled in the course.",
        ],
        REQUEST_ALREADY_RESOLVED: [
          409,
          "This request has already been resolved.",
        ],
        REQUEST_SESSION_MISMATCH: [
          409,
          "This request is for a different session. Cross-session approval is not allowed.",
        ],
        ALREADY_CHECKED_IN: [409, "This student has already checked in."],
      };
      const knownError = knownErrors[error.message];
      if (knownError)
        return res.status(knownError[0]).json({ error: knownError[1] });
      throw error;
    }

    return res
      .status(200)
      .json({ success: true, message: "Request approved." });
  } catch (error) {
    console.error("Approve manual error:", error);
    return res
      .status(500)
      .json({ error: "Unable to approve the request. Please try again." });
  }
}

async function handleGrantHotspot(req, res, decoded) {
  try {
    const { courseId, targetMatric } = req.body || {};
    if (!courseId || !targetMatric)
      return res
        .status(400)
        .json({ error: "Course ID and target matric are required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists)
      return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const memberSnap = await courseRef
      .collection("members")
      .doc(decoded.uid)
      .get();
    const isRep = courseData.repUid === decoded.uid;
    if (!isRep)
      return res
        .status(403)
        .json({ error: "Only the course rep can grant hotspot access." });

    const liveRef = courseRef.collection("session").doc("live");
    const secretRef = courseRef.collection("session").doc("secret");
    const liveSnap = await liveRef.get();
    if (!liveSnap.exists)
      return res.status(403).json({ error: "No live session." });

    const live = liveSnap.data();
    const secretSnap = await secretRef.get();
    if (!secretSnap.exists)
      return res.status(403).json({ error: "No live session." });
    const secret = secretSnap.data();
    const normalizedTarget = norm(targetMatric);
    if (!(secret.attendees || []).includes(normalizedTarget))
      return res
        .status(403)
        .json({ error: "Target student has not checked in yet." });

    const legacyCount = Number.isInteger(secret.hotspotGrantCount)
      ? secret.hotspotGrantCount
      : (
          await courseRef
            .collection("hotspotLog")
            .where("sessionExpiresAt", "==", live.expiresAt)
            .count()
            .get()
        ).data().count;

    const targetMemberSnap = await courseRef
      .collection("members")
      .where("matric", "==", normalizedTarget)
      .limit(1)
      .get();
    if (targetMemberSnap.empty)
      return res
        .status(404)
        .json({ error: "Student not found in this course." });

    const targetUid = targetMemberSnap.docs[0].id;
    const targetRef = courseRef.collection("members").doc(targetUid);
    const rlRef = courseRef
      .collection("hotspotLog")
      .doc(`${escKeyPart(normalizedTarget)}_${live.expiresAt}`);

    // Granter identity is read OUTSIDE the transaction — plain reads inside a
    // tx block give no consistency guarantee across transaction retries.
    const granterSnap = await db.collection("users").doc(decoded.uid).get();
    const granterMatric = granterSnap.exists
      ? norm(granterSnap.data().matric) || "rep"
      : "rep";

    try {
      await db.runTransaction(async (tx) => {
        const [liveTxnSnap, secretTxnSnap, targetTxnSnap, existingGrantSnap] =
          await Promise.all([
            tx.get(liveRef),
            tx.get(secretRef),
            tx.get(targetRef),
            tx.get(rlRef),
          ]);
        if (!liveTxnSnap.exists || !secretTxnSnap.exists)
          throw new Error("NO_LIVE_SESSION");
        if (liveTxnSnap.data().expiresAt !== live.expiresAt)
          throw new Error("SESSION_CHANGED");
        if (
          !targetTxnSnap.exists ||
          norm(targetTxnSnap.data().matric) !== normalizedTarget
        )
          throw new Error("STUDENT_NOT_FOUND");
        if (existingGrantSnap.exists) throw new Error("ALREADY_GRANTED");

        const currentSecret = secretTxnSnap.data();
        if (!(currentSecret.attendees || []).includes(normalizedTarget))
          throw new Error("NOT_CHECKED_IN");
        if (targetTxnSnap.data().role !== "student")
          throw new Error("ALREADY_STAFF");
        const grantCount = Number.isInteger(currentSecret.hotspotGrantCount)
          ? currentSecret.hotspotGrantCount
          : legacyCount;
        if (grantCount >= 5) throw new Error("HOTSPOT_LIMIT");

        tx.update(secretRef, { hotspotGrantCount: grantCount + 1 });
        tx.update(targetRef, { role: "session_assistant" });
        tx.update(courseRef, {
          assistants: FieldValue.arrayUnion(normalizedTarget),
        });
        tx.create(rlRef, {
          matric: normalizedTarget,
          grantedByMatric: granterMatric,
          sessionExpiresAt: live.expiresAt,
          grantedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      const responses = {
        NO_LIVE_SESSION: [403, "No live session."],
        SESSION_CHANGED: [409, "The session changed. Refresh and try again."],
        STUDENT_NOT_FOUND: [404, "Student not found in this course."],
        ALREADY_GRANTED: [
          409,
          "This student already has hotspot access for this session.",
        ],
        NOT_CHECKED_IN: [403, "Target student has not checked in yet."],
        ALREADY_STAFF: [409, "This student already has course staff access."],
        HOTSPOT_LIMIT: [403, "Hotspot limit reached (max 5 per session)."],
      };
      const response = responses[error.message];
      if (response) return res.status(response[0]).json({ error: response[1] });
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: `${normalizedTarget} granted hotspot access.`,
    });
  } catch (error) {
    console.error("Grant hotspot error:", error);
    return res
      .status(500)
      .json({ error: "Unable to grant hotspot power. Please try again." });
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    await verifyAppCheck(req);
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAuth().verifyIdToken(header.slice(7));
    const action = req.query.action;
    switch (action) {
      case "requestManual":
        return handleRequestManual(req, res, decoded);
      case "approveManual":
        return handleApproveManual(req, res, decoded);
      case "grantHotspot":
        return handleGrantHotspot(req, res, decoded);
      default:
        return res
          .status(400)
          .json({
            error:
              "Invalid action. Use: requestManual, approveManual, grantHotspot",
          });
    }
  } catch (error) {
    console.error("Approval API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
