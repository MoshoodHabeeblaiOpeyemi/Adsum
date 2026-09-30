// Adsum — prune adviser accounts that were never verified (Phase 5 UX).
//
// WHY THIS EXISTS
// ---------------
// Applying as an adviser reserves a real thing: one adviser per
// (institution, department, level). Without an expiry, someone can apply with a
// university address, never enter the code, and permanently lock out the
// department's actual Level Adviser. That is a denial of service on a
// one-adviser-per-level rule, so unverified applications are temporary and
// reclaimed.
//
//   12h -> email a warning. The account still works; nothing is lost.
//   24h -> delete, INCLUDING the Firebase Auth user, so the address is free to
//          re-apply immediately.
//
// 🔒 SAFETY: an UNVERIFIED adviser holds no adviserSlots row (that is only
// written when the code is accepted), cannot have created a course, and cannot
// have imported a roster, because the dashboard is gated on
// isVerifiedAdviser(). Deleting one cannot orphan a level, a course or a rep.
//
// Run by Vercel Cron. Manually triggerable with `?action=run`; it refuses
// anything without CRON_SECRET so it cannot become a public delete API.

const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { sendVerificationCode } = require("../utils/mailer");

try {
  if (getApps().length === 0) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
} catch (e) { if (!/already exists/.test(e.message)) console.error("Init error:", e); }

const db = getFirestore();

const HOUR = 60 * 60 * 1000;
const WARN_AFTER_MS = 12 * HOUR;
const DELETE_AFTER_MS = 24 * HOUR;

/** Milliseconds since a Timestamp / number / ISO string, or null if unusable. */
function ageMs(value, now = Date.now()) {
  if (value == null) return null;
  let ms = null;
  if (typeof value === "number") ms = value;
  else if (typeof value === "object" && typeof value.toMillis === "function") ms = value.toMillis();
  else if (typeof value === "object" && typeof value.seconds === "number") ms = value.seconds * 1000;
  else {
    const d = new Date(value);
    ms = Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  if (ms === null || !Number.isFinite(ms)) return null;
  return now - ms;
}


/**
 * Warn (first pass) or delete (second pass) for ONE unverified adviser.
 * Failures are collected, never thrown, so one bad document cannot abort the
 * whole sweep.
 */
async function purgeOne(profile, now) {
  const uid = profile.uid;
  const out = { uid, email: profile.email || null, warned: false, deleted: false, error: null };
  try {
    if (profile.verificationWarnedAt !== true) {
      const age = ageMs(profile.createdAt, now);
      // 🔒 Do not delete on this pass. It exists only to warn, and only for
      // accounts genuinely past the half-way mark.
      if (age === null || age < DELETE_AFTER_MS) {
        // Reuse the mailer: it degrades gracefully when Resend is unset, and a
        // missing warning must never block the deletion that follows.
        await sendVerificationCode({
          to: profile.email,
          code: "------",
          institutionId: profile.institution,
          level: profile.level,
          department: profile.department,
        });
        await db.collection("users").doc(uid).set(
          { verificationWarnedAt: true, verificationWarnedAtTs: FieldValue.serverTimestamp() },
          { merge: true },
        );
        out.warned = true;
        console.log(`pruneAdvisers: warned ${uid} (${out.email}) at ${Math.round(age / HOUR)}h`);
      }
      return out;
    }

    // Full deletion. The transient code and profile go first; Auth last, so if
    // it fails the user is still reachable and a retry can finish the job.
    await db.collection("adviserVerifications").doc(uid).delete().catch(() => {});
    await db.collection("users").doc(uid).delete();
    out.deleted = true;
    try {
      await getAuth().deleteUser(uid);
      out.authDeleted = true;
    } catch (e) {
      out.authDeleted = false;
      console.error("pruneAdvisers: Auth user not deleted", uid, e.message);
    }
    console.log(`pruneAdvisers: deleted ${uid} (${out.email}) aged ${Math.round(ageMs(profile.createdAt, now) / HOUR)}h`);
  } catch (e) {
    out.error = e.message;
    console.error("pruneAdvisers: failed for", uid, e.message);
  }
  return out;
}

async function handlePruneAdvisers(req, res) {
  const now = Date.now();
  const summary = { scanned: 0, warned: 0, deleted: 0, failed: 0, results: [] };
  try {
    // 🔒 Pinned to the exact unverified state, so a verified adviser — or any
    // other account — is invisible to this query whatever it claims.
    const snap = await db
      .collection("users")
      .where("role", "==", "adviser")
      .where("verificationStatus", "==", "pending_email")
      .limit(400)
      .get();

    summary.scanned = snap.size;
    for (const docSnap of snap.docs) {
      const profile = docSnap.data();
      const created = ageMs(profile.createdAt, now);
      // No usable createdAt: leave it alone rather than delete on a guess.
      if (created === null || created < WARN_AFTER_MS) continue;
      const r = await purgeOne({ ...profile, uid: docSnap.id }, now);
      summary.results.push(r);
      if (r.deleted) summary.deleted++;
      else if (r.warned) summary.warned++;
      if (r.error) summary.failed++;
    }
    const { results, ...loggable } = summary;
    console.log("pruneAdvisers:", JSON.stringify(loggable));
    return res.status(200).json({ success: true, ...summary });
  } catch (error) {
    console.error("pruneAdvisers error:", error);
    return res.status(500).json({ error: "Prune failed." });
  }
}

module.exports = async (req, res) => {
  // Vercel Cron issues a GET authenticated with `Authorization: Bearer
  // $CRON_SECRET`. Anything else is refused so this cannot be triggered by a
  // stranger to force a sweep.
  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization || "";
  if (!secret || header !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  return handlePruneAdvisers(req, res);
};
