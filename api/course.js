const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");

try {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\n/g, "\n"),
      }),
    });
  }
} catch (error) {
  if (!/already exists/.test(error.message)) console.error("Firebase Admin Init Error:", error);
}

const db = getFirestore();

// COURSE ACTIONS - enroll, leave, delete.
// (`remove` was here until the rep lost that power; see the note above
// handleDelete for where it went and why.)
const norm = (v) => String(v || "").trim().toUpperCase();

// Firestore document IDs cannot contain "/", but matric numbers often do
// (e.g. 24/56SV002) — that crashed enroll with "Expected documentPath".
// Registry keys percent-encode the illegal/ambiguous characters. "%" MUST be
// encoded first so the mapping stays reversible: no two different matrics can
// ever collapse into the same registry document.
const escKeyPart = (v) =>
  String(v || "")
    .trim()
    .toUpperCase()
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/\|/g, "%7C");
const registryDocId = (institution, matric) =>
  `${escKeyPart(institution) || "UNKNOWN"}|${escKeyPart(matric)}`;

async function handleEnroll(req, res, decoded) {
  try {
    const { courseId: bodyCourseId, courseCode } = req.body || {};

    let courseRef;
    if (bodyCourseId) {
      // Direct-ID enroll (programmatic callers).
      courseRef = db.collection("courses").doc(bodyCourseId);
    } else if (courseCode) {
      // Join-by-code (the client flow): resolve the code to a course.
      const codeQuery = await db
        .collection("courses")
        .where("code", "==", norm(courseCode))
        .limit(1)
        .get();
      if (codeQuery.empty) return res.status(404).json({ error: "Course not found." });
      courseRef = codeQuery.docs[0].ref;
    } else {
      return res.status(400).json({ error: "courseId or courseCode is required." });
    }

    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });
    const courseData = courseSnap.data();
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    if (!userSnap.exists) return res.status(404).json({ error: "User profile not found." });
    const userData = userSnap.data();
    const matric = norm(userData.matric);
    if (!matric) return res.status(400).json({ error: "You need a matric number to enroll." });
    if (courseData.institution && norm(courseData.institution) !== norm(userData.institution))
      return res.status(403).json({ error: "Institution mismatch." });
    if (courseData.department && norm(courseData.department) !== norm(userData.department))
      return res.status(403).json({ error: "Department mismatch." });
    if (courseData.level && norm(courseData.level) !== norm(userData.level))
      return res.status(403).json({ error: "Level mismatch." });
    const memberRef = courseRef.collection("members").doc(decoded.uid);
    const regInst = norm(userData.institution) || "UNKNOWN";
    const registryKey = registryDocId(regInst, matric);
    const registryRef = db.collection("matricRegistry").doc(registryKey);
    if (String(process.env.REQUIRE_EMAIL_VERIFIED || "").toLowerCase() === "true") {
      if (!decoded.email_verified)
        return res.status(403).json({ error: "Verify your email before enrolling.", emailNotVerified: true });
    }
    try {
      await db.runTransaction(async (tx) => {
        // ALL reads first — Firestore transactions require every read to
        // happen before any write.
        const regSnap = await tx.get(registryRef);
        const memberSnap = await tx.get(memberRef);
        if (regSnap.exists && regSnap.data().uid !== decoded.uid)
          throw new Error("MATRIC_CLAIMED_BY_ANOTHER");
        tx.set(registryRef, { uid: decoded.uid, matric, institution: regInst,
          department: norm(userData.department) || null, level: norm(userData.level) || null,
          claimedAt: FieldValue.serverTimestamp() }, { merge: true });
        if (memberSnap.exists) return;
        tx.set(memberRef, { uid: decoded.uid, matric,
          name: String(userData.name || "").trim() || matric,
          role: "student", joinedAt: FieldValue.serverTimestamp() });
        tx.update(courseRef, { enrolled: FieldValue.arrayUnion(matric) });
      });
    } catch (txErr) {
      if (txErr.message === "MATRIC_CLAIMED_BY_ANOTHER")
        return res.status(409).json({ error: "Matric " + matric + " already claimed.", matricClaimed: true });
      throw txErr;
    }
    return res.status(200).json({ success: true, message: "Enrolled.", courseId: courseRef.id });
  } catch (error) {
    console.error("Enroll error:", error);
    return res.status(500).json({ error: "Unable to join the course. Please try again." });
  }
}

async function handleLeave(req, res, decoded) {
  try {
    const { courseId } = req.body || {};
    if (!courseId) return res.status(400).json({ error: "Course ID is required." });
    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });
    if (courseSnap.data().repUid === decoded.uid)
      return res.status(403).json({ error: "Rep cannot leave. Transfer or delete instead." });
    const memberRef = courseRef.collection("members").doc(decoded.uid);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) return res.status(404).json({ error: "Not enrolled." });
    const matric = norm(memberSnap.data().matric);
    await db.runTransaction(async (tx) => {
      tx.delete(memberRef);
      tx.update(courseRef, { enrolled: FieldValue.arrayRemove(matric), assistants: FieldValue.arrayRemove(matric) });
    });
    return res.status(200).json({ success: true, message: "Left the course." });
  } catch (error) {
    console.error("Leave error:", error);
    return res.status(500).json({ error: "Unable to leave the course. Please try again." });
  }
}

// 🛑 handleRemove USED TO LIVE HERE and it is gone on purpose.
//
// Course reps can no longer remove students from a roster. Hiding the button
// would not have been enough: this endpoint granted the power SERVER-SIDE to
// anyone whose uid matched `repUid`, so a rep could have kept calling
// `POST /api/course?action=remove` straight from devtools. The ability is
// revoked here, at the boundary, rather than in the UI.
//
// WHY IT MOVED RATHER THAN DISAPPEARED
// A rep still needs a way to deal with someone who joined the course code
// but should not be in the class. That power now belongs to the Level
// Adviser — the trust root for the level — via
// `api/roster.js -> removeCourseStudent`, which checks the adviser's own
// (institution, department, level) against the COURSE's, so one adviser can
// never reach another's class.
//
// WHAT THE REP STILL HAS
// 🚩 Flag Absent, on the Live Roster. It is permanent, it alerts the student
// immediately, and it cannot be quietly undone — which is why it was the
// better tool for the job in the first place.
//
// `removalLog` is retained and still written to (by the adviser action), so
// the audit trail of every past removal stays readable forever.

async function handleDelete(req, res, decoded) {
  try {
    const { courseId } = req.body || {};
    if (!courseId || typeof courseId !== "string")
      return res.status(400).json({ error: "Course ID is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });
    if (courseSnap.data().repUid !== decoded.uid)
      return res.status(403).json({ error: "Only the course rep can delete this course." });

    const subcollections = ["members", "session", "attendance", "checkins", "deviceFlags", "absentFlags", "manualRequests", "hotspotLog", "removalLog", "exemptions", "exemptionReasons", "securityEvents", "notifications"];

    for (const sub of subcollections) {
      try {
        let snap = await courseRef.collection(sub).limit(500).get();
        while (!snap.empty) {
          const batch = db.batch();
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          snap = await courseRef.collection(sub).limit(500).get();
        }
      } catch (err) {
        console.warn("Could not delete subcollection " + sub + ": " + err.message);
      }
    }

    await courseRef.delete();
    return res.status(200).json({ success: true, message: "Course deleted." });
  } catch (error) {
    console.error("Delete course error:", error);
    return res.status(500).json({ error: "Unable to delete the course. Please try again." });
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
      case "enroll": return handleEnroll(req, res, decoded);
      case "leave": return handleLeave(req, res, decoded);
      case "delete": return handleDelete(req, res, decoded);
      default:
        return res.status(400).json({
          error:
            "Invalid action. Use: enroll, leave, delete. Removing a student is a Level Adviser action now — see api/roster.js?action=removeCourseStudent.",
        });
    }
  } catch (error) {
    console.error("Course API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
