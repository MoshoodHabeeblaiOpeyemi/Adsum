// VeriPresenX — server-side throttling for PIN submission.
//
// WHY A TRANSACTION
// -----------------
// The obvious implementation is read-then-write:
//
//     const snap = await ref.get();
//     if (snap.data().count >= 5) return 429;
//     await ref.set({ count: snap.data().count + 1 });
//
// That is a check-then-act race, and it is exactly the bug class this file
// exists to close. An attacker running 50 parallel requests reads `count: 0`
// fifty times before any of them writes, so all fifty sail through. A limiter
// with a race in it is worse than no limiter, because it looks like one.
//
// So the increment happens INSIDE a transaction, which Firestore retries on
// contention. Parallel bursts serialise and every one of them sees the real
// count.
//
// SCOPE
// -----
// Keyed on `uid_courseId`, not on IP: a shared campus NAT, a phone switching
// between Wi-Fi and mobile data, and a VPN all change the IP mid-session, while
// the authenticated uid does not. The threat here is a student brute-forcing a
// PIN, and they cannot change their uid.
//
// Reset on success, so a student who fat-fingers a PIN three times and then
// types it correctly is not punished for the rest of the session.

const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();

// A 4-digit PIN is 10,000 values. Five misses per ~30 seconds means a full
// sweep of the keyspace takes ~16.6 hours instead of under a minute, which puts
// it far outside any single class session.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 30 * 1000;

/**
 * Count a failed PIN attempt for this (user, course) and report whether the
 * caller is now locked out.
 *
 * @returns {Promise<{blocked: boolean, attempts: number, retryAfterSeconds: number}>}
 */
async function recordFailure(uid, courseId) {
  const ref = db.collection("pinAttempts").doc(`${uid}_${courseId}`);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const last = Number(data.lastAttempt || 0);
    const windowStart = now - WINDOW_MS;

    // The window slides: attempts older than WINDOW_MS stop counting. A
    // student who stops guessing for 30 seconds gets a clean slate.
    const withinWindow = last > windowStart;
    const attempts = withinWindow ? Number(data.count || 0) + 1 : 1;

    tx.set(ref, {
      uid,
      courseId,
      count: attempts,
      lastAttempt: now,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      blocked: attempts >= MAX_ATTEMPTS,
      attempts,
      retryAfterSeconds: Math.max(1, Math.ceil((last + WINDOW_MS - now) / 1000)),
    };
  });
}

/** Clear the counter after a correct PIN, so honest typos do not accumulate. */
async function recordSuccess(uid, courseId) {
  try {
    await db.collection("pinAttempts").doc(`${uid}_${courseId}`).delete();
  } catch (e) {
    // A stale counter only delays the next legitimate check-in by 30 seconds.
    // Never fail a good check-in because cleanup failed.
    console.error("pinAttempts cleanup failed:", e.message);
  }
}

/** Is this pair already locked out? Read-only, for early rejection. */
async function isBlocked(uid, courseId) {
  try {
    const snap = await db.collection("pinAttempts").doc(`${uid}_${courseId}`).get();
    if (!snap.exists) return false;
    const d = snap.data();
    return Number(d.count || 0) >= MAX_ATTEMPTS && Date.now() - Number(d.lastAttempt || 0) < WINDOW_MS;
  } catch (e) {
    // Fail OPEN here on purpose: if the throttle store is unreachable, blocking
    // every student in the hall is a worse outcome than briefly losing the
    // rate limit. The PIN is still required and still rotates.
    console.error("pinAttempts read failed, failing open:", e.message);
    return false;
  }
}

module.exports = { recordFailure, recordSuccess, isBlocked, MAX_ATTEMPTS, WINDOW_MS };
