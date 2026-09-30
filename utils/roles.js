// Adsum — the ONE definition of role and verification state.
//
// WHY THIS FILE EXISTS
// --------------------
// There are two adviser values in the data model and they are NOT the same
// thing:
//
//   role: "adviser"      → signed up as an adviser, NOT yet verified.
//                           verificationStatus: "pending_email"
//   role: "level_anchor"  → PROVEN staff. Only api/verification.js (Admin SDK)
//                           can write this, after the emailed code checks out.
//                           verificationStatus: "verified"
//
// The trap this module exists to kill: a gate written as
// `if (user.role === "adviser")` looks correct and is a PRIVILEGE ESCALATION,
// because "adviser" is the value held by every UNVERIFIED applicant. Use
// `isVerifiedAdviser(profile)` instead and the mistake is impossible.
//
// Naming: the UI says "Level Adviser" (ROLE_LABEL in app.js), the pending
// value is "adviser", and the verified value is "level_anchor". We do NOT
// rename the stored values — doing so would mean migrating live documents for
// zero security gain once every gate goes through this module. The values are
// documented here so the vocabulary has exactly one home.

/** Roles a user may hold. `level_anchor` is deliberately NOT here: it is
 *  server-minted, never client-selectable. */
const ROLE = {
  STUDENT: "student",
  REP: "rep",
  ADVISER_PENDING: "adviser",
  LEVEL_ANCHOR: "level_anchor",
};

/** The only three values api/onboarding.js will accept from a signup body. */
const SIGNUP_ROLES = [ROLE.STUDENT, ROLE.REP, ROLE.ADVISER_PENDING];

const VERIFICATION = {
  NOT_REQUIRED: "not_required",
  PENDING_EMAIL: "pending_email",
  VERIFIED: "verified",
};

/** Everyone in the adviser track, verified or not. Good for "can I start
 *  verification", NEVER for "can I use adviser powers". */
function isAdviserTrack(profile) {
  if (!profile) return false;
  return profile.role === ROLE.ADVISER_PENDING || profile.role === ROLE.LEVEL_ANCHOR;
}

/**
 * 🔒 THE ONLY correct adviser-authorisation check.
 *
 * Requires BOTH the minted role and the verified status, so an account that
 * somehow holds one without the other still fails closed. Every dashboard,
 * every roster write and every trust-chain decision must call this.
 */
function isVerifiedAdviser(profile) {
  if (!profile) return false;
  return profile.role === ROLE.LEVEL_ANCHOR && profile.verificationStatus === VERIFICATION.VERIFIED;
}

/** Is this an account that is waiting on an emailed code? */
function isPendingAdviser(profile) {
  if (!profile) return false;
  return profile.role === ROLE.ADVISER_PENDING && profile.verificationStatus === VERIFICATION.PENDING_EMAIL;
}

module.exports = {
  ROLE,
  SIGNUP_ROLES,
  VERIFICATION,
  isAdviserTrack,
  isVerifiedAdviser,
  isPendingAdviser,
};
