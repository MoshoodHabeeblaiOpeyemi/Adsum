const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");

try {
  if (getApps().length === 0) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
} catch (e) { if (!/already exists/.test(e.message)) console.error("Init error:", e); }

const db = getFirestore();

async function handleEndSemester(req, res, decoded) {
  try {
    const { courseId } = req.body || {};
    if (!courseId) return res.status(400).json({ error: "Course ID is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    if (courseSnap.data().repUid !== decoded.uid) return res.status(403).json({ error: "Only the course rep can end the semester." });

    const batch = db.batch();
    batch.update(courseRef, { activeSession: null, session: null });
    await batch.commit();

    // Delete subcollections
    const subs = ["session", "attendance", "checkins", "deviceFlags"];
    for (const sub of subs) {
      let snap = await courseRef.collection(sub).limit(500).get();
      while (!snap.empty) { const b = db.batch(); snap.docs.forEach(d => b.delete(d.ref)); await b.commit(); snap = await courseRef.collection(sub).limit(500).get(); }
    }

    return res.status(200).json({ success: true, message: "Semester ended. All session data cleared." });
  } catch (error) {
    console.error("End semester error:", error);
    return res.status(500).json({ error: "Unable to end the semester. Please try again." });
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
      case "endSemester": return handleEndSemester(req, res, decoded);
      default: return res.status(400).json({ error: "Invalid action. Use: endSemester" });
    }
  } catch (error) {
    console.error("Semester API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
