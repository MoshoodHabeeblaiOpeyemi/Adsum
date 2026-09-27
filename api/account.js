const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");

try {
  if (getApps().length === 0) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
} catch (e) { if (!/already exists/.test(e.message)) console.error("Init error:", e); }

const db = getFirestore();
const norm = (v) => String(v || "").trim().toUpperCase();
// Firestore doc IDs cannot contain "/", but matric numbers often do (24/56SV002) — that crashed enroll with "Expected documentPath".
// Registry keys percent-encode illegal/ambiguous chars; "%" is encoded FIRST so the mapping stays reversible (no collisions).
const escKeyPart = (v) => String(v || "").trim().toUpperCase().replace(/%/g, "%25").replace(/\//g, "%2F").replace(/\|/g, "%7C");
const registryDocId = (institution, matric) => `${escKeyPart(institution) || "UNKNOWN"}|${escKeyPart(matric)}`;
const COURSE_SUBS = ["members","session","attendance","checkins","deviceFlags","absentFlags","manualRequests","hotspotLog","removalLog","exemptions","exemptionReasons","securityEvents","notifications"];

async function delSub(ref) {
  let snap = await ref.limit(500).get(), total = 0;
  while (!snap.empty) { const b = db.batch(); snap.docs.forEach(d => b.delete(d.ref)); await b.commit(); total += snap.size; snap = await ref.limit(500).get(); }
  return total;
}

async function handleDeleteAccount(req, res, decoded) {
  try {
    const uid = decoded.uid;
    const profileRef = db.collection("users").doc(uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) return res.status(404).json({ error: "Profile not found." });
    const profile = profileSnap.data();
    const matric = norm(profile.matric), institution = norm(profile.institution) || "UNKNOWN";

    // 🔍 WHICH COURSES IS THIS USER IN?
    //
    // A collection-group query needs an explicit Firestore index — there is no
    // automatic one. Without firestore.indexes.json this throws
    // 9 FAILED_PRECONDITION INSTANTLY, which the browser then reports as
    // "Network Error" and the user blames their connection.
    //
    // It used to sit in the generic catch below, where it vanished into a
    // generic "please try again". An operational fault deserves its own log
    // line and its own status code, so it is separated here.
    let memberships;
    try {
      memberships = await db.collectionGroup("members").where("uid", "==", uid).get();
    } catch (queryErr) {
      const code = queryErr && queryErr.code;
      if (code === 9 || /FAILED_PRECONDITION|requires an index/i.test(String(queryErr && queryErr.message))) {
        console.error(
          "deleteAccount: Firestore index missing. Deploy it with: firebase deploy --only firestore:indexes",
          queryErr.message,
        );
        return res.status(503).json({
          error: "Account deletion is temporarily unavailable. Please try again shortly.",
          code: "INDEX_NOT_DEPLOYED",
        });
      }
      throw queryErr;
    }

    const courseIds = new Set(); memberships.docs.forEach(d => courseIds.add(d.ref.parent.parent.id));
    let coursesLeft = 0, coursesDeleted = 0;
    for (const courseId of courseIds) {
      const courseRef = db.collection("courses").doc(courseId);
      const courseSnap = await courseRef.get();
      if (!courseSnap.exists) continue;
      if (courseSnap.data().repUid === uid) {
        for (const sub of COURSE_SUBS) { try { await delSub(courseRef.collection(sub)); } catch(e) { console.warn(e.message); } }
        await courseRef.delete(); coursesDeleted++;
      } else {
        const memberRef = courseRef.collection("members").doc(uid);
        await db.runTransaction(async (tx) => { tx.delete(memberRef); tx.update(courseRef, { enrolled: FieldValue.arrayRemove(matric), assistants: FieldValue.arrayRemove(matric) }); });
        coursesLeft++;
      }
    }
    if (matric) {
      const regRef = db.collection("matricRegistry").doc(registryDocId(institution, matric));
      const regSnap = await regRef.get();
      if (regSnap.exists && regSnap.data().uid === uid) await regRef.delete();
    }
    await profileRef.delete();
    try { await getAuth().deleteUser(uid); } catch(_) {}
    return res.status(200).json({ success: true, coursesLeft, coursesDeleted });
  } catch (error) {
    console.error("Delete account error:", error);
    return res.status(500).json({ error: "Unable to delete your account. Please try again." });
  }
}

async function handleClaimMatric(req, res, decoded) {
  try {
    if (String(process.env.REQUIRE_EMAIL_VERIFIED || "").toLowerCase() === "true" && !decoded.email_verified)
      return res.status(403).json({ error: "Please verify your email first.", emailNotVerified: true });
    const profile = await db.collection("users").doc(decoded.uid).get();
    if (!profile.exists || !profile.data().matric) return res.status(400).json({ error: "Profile with matric required." });
    const matric = norm(profile.data().matric), institution = norm(profile.data().institution) || "UNKNOWN";
    const regRef = db.collection("matricRegistry").doc(registryDocId(institution, matric));
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(regRef);
        if (snap.exists && snap.data().uid !== decoded.uid) throw new Error("MATRIC_CLAIMED_BY_ANOTHER");
        tx.set(regRef, { uid: decoded.uid, matric, institution, department: norm(profile.data().department) || null, level: norm(profile.data().level) || null, claimedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
    } catch (txError) {
      if (txError.message === "MATRIC_CLAIMED_BY_ANOTHER") return res.status(409).json({ error: `Matric ${matric} already claimed.`, matricClaimed: true });
      throw txError;
    }
    return res.status(200).json({ success: true, message: `Matric ${matric} secured.` });
  } catch (error) {
    console.error("Claim matric error:", error);
    return res.status(500).json({ error: "Unable to secure that matric number. Please try again." });
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
      case "deleteAccount": return handleDeleteAccount(req, res, decoded);
      case "claimMatric": return handleClaimMatric(req, res, decoded);
      default: return res.status(400).json({ error: "Invalid action. Use: deleteAccount, claimMatric" });
    }
  } catch (error) {
    console.error("Account API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};