// VeriPresenX — server-side onboarding (Phase 3).
//
// WHY THIS FILE EXISTS
// --------------------
// The client used to write `users/{uid}` itself. That works, but it makes the
// account's identity a client ASSERTION: anyone with devtools can replay the
// signup call with `role: "level_anchor"` / `verificationStatus: "verified"`
// and the only thing in the way is `firestore.rules`. A rule is a denylist of
// shapes; a server-owned write is an allowlist of behaviour.
//
// So the profile write moves here. The client posts what the user typed; this
// function decides what is TRUE and writes that. Two rules follow:
//   1. `role` is validated against a fixed set. An unknown value is a 400, not
//      a silent downgrade — `level_anchor` is exactly what a tampered client
//      would send, and a 403 would confirm the value is real.
//   2. `role` / `isAdviser` / `verificationStatus` / `verifiedAt` /
//      `verificationMethod` are BUILT HERE and never copied from the body.
//
// ADVISER SIGNUP ALSO GETS ITS FIRST CODE
// ----------------------------------------
// An adviser's entire claim to authority is a school email address. The first
// 6-digit code is minted and mailed HERE, at signup, rather than making the
// user finish signing up and then go hunting for a "resend" button. The code is
// never echoed back — it exists only in `adviserVerifications/{uid}` and in
// the inbox. api/verification.js then verifies it and claims the adviser slot
// in the same transaction that promotes the account.
//
// ENDPOINT
// --------
//   POST /api/onboarding?action=createProfile
//   Authorization: Bearer <Firebase ID token>   (always required)
//   x-firebase-appcheck: <token>                (hard mode only)
//
//   Body: { role, name, firstName, middleName, lastName, matric,
//           institution, department, level, email? }
//   200 → { success, role, isRep, isAdviser, verification? }
//   400 invalid input   403 domain not official   409 slot/profile taken
//   503 institution registry not seeded
//
// The caller owns the Firebase Auth account: this function never creates or
// deletes one. app.js already deletes the Auth user when a signup is refused
// (the REP_SLOT_TAKEN path), and that stays the client's job.

const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const verifyAppCheck = require("../utils/appCheck");
const { ROLE, VERIFICATION, SIGNUP_ROLES, isAdviserTrack } = require("../utils/roles");
const { isInstitutionDomain } = require("../utils/institutions");
const { sendVerificationCode } = require("../utils/mailer");

try {
  if (getApps().length === 0) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
} catch (e) { if (!/already exists/.test(e.message)) console.error("Init error:", e); }

const db = getFirestore();
const norm = (v) => String(v || "").trim().toUpperCase();

// Kept identical to api/verification.js so a code minted at signup expires on
// the same clock a resent one does.
const CODE_TTL_MS = 10 * 60 * 1000;

// Cryptographically-seeded 6-digit code (Math.random is not for secrets).
const codeFor = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

// The only roles a signup may REQUEST, imported from utils/roles.js so this
// whitelist and the authorisation checks in api/verification.js can never
// drift apart. `level_anchor` is absent on purpose: it is minted server-side
// after verification and is never client-selectable.

// Long enough for every real Nigerian institution / department / level string,
// short enough that a 4 KB "institution" is rejected rather than stored.
const MAX_FIELD = 120;

const clean = (v) => String(v == null ? "" : v).trim();
const overLong = (s) => s.length > MAX_FIELD;

/**
 * Mirrors the id api/verification.js builds when it claims an adviser slot.
 *
 * ⚠️ Reproduced FAITHFULLY, including a quirk: there the `.replace()` is
 * chained onto the whole template literal, so the lower-case literal "adviser"
 * is itself rewritten to "_______" and the real id is e.g.
 * "________UNILORIN_GEOLOGY_200L". That looks like a bug, and it is a cosmetic
 * one — but "fixing" it here alone would make this pre-flight read a DIFFERENT
 * slot document than verifyCode writes, so a taken level would look free at
 * signup. Both files must be changed together, and the live `adviserSlots`
 * collection migrated in the same commit.
 */
const adviserSlotId = (institution, department, level) =>
  `adviser_${norm(institution)}_${norm(department)}_${norm(level)}`.replace(/[^A-Z0-9_]/g, "_");

/**
 * ⚠️ Byte-for-byte copy of the recipe app.js used before this endpoint existed.
 * Changing it would orphan every live `departmentReps` document: the new ids
 * would not collide with the old ones, so a SECOND rep could claim a level that
 * already has one. If this is ever changed, migrate the collection in the same
 * commit — never on its own.
 */
const repSlotId = (institution, department, level) => {
  const inst = institution.replace(/[^a-zA-Z0-9]/g, "_");
  const dept = department.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const lvl = level.replace(/[^a-zA-Z0-9]/g, "_");
  return `rep_${inst}_${dept}_${lvl}`;
};


/**
 * Normalise and validate the posted profile. Returns `{ ok: true, profile }` or
 * `{ ok: false, status, error }` so the handler can answer without duplicating
 * the checks. Nothing here trusts a value's TYPE — every field is coerced to a
 * trimmed string and length-capped before it can reach Firestore.
 */
function buildProfile(body, decoded) {
  const fail = (status, error) => ({ ok: false, status, error });

  const role = clean(body.role).toLowerCase();
  if (!SIGNUP_ROLES.includes(role)) {
    return fail(400, `role must be one of: ${SIGNUP_ROLES.join(", ")}.`);
  }
  const isAdviser = role === ROLE.ADVISER_PENDING;
  const isRep = role === ROLE.REP;

  const institution = clean(body.institution);
  const department = clean(body.department);
  const level = clean(body.level);
  if (!institution) return fail(400, "institution is required.");
  if (!department) return fail(400, "department is required.");
  if (!level) return fail(400, "level is required.");
  if (overLong(institution) || overLong(department) || overLong(level)) {
    return fail(400, "institution, department and level are too long.");
  }

  // 📧 The address is read from the VERIFIED ID TOKEN, never from the body.
  // The token is signed by Firebase and is the only proof we have that the
  // person controls this mailbox. `body.email` is only used to CONFIRM the
  // form and the account agree — if a tampered client posts someone else's
  // address we refuse rather than mail a code to a stranger.
  const tokenEmail = String(decoded.email || "").trim().toLowerCase();
  if (!tokenEmail) return fail(403, "This account has no email address to verify.");
  const bodyEmail = clean(body.email).toLowerCase();
  if (bodyEmail && bodyEmail !== tokenEmail) {
    return fail(400, "The email on this form does not match your signed-in account.");
  }

  const name = clean(body.name);
  const firstName = clean(body.firstName);
  const middleName = clean(body.middleName);
  const lastName = clean(body.lastName);
  if (overLong(name) || overLong(firstName) || overLong(middleName) || overLong(lastName)) {
    return fail(400, "Name fields are too long.");
  }
  if (!name) return fail(400, "name is required.");

  // Matric is the student's identity key and is PERMANENT, so it is normalised
  // to upper case here exactly as api/account.js does when writing
  // `matricRegistry` — otherwise "24/56sv002" and "24/56SV002" would be two
  // different students in the registry.
  const matric = norm(body.matric);
  if (isAdviser) {
    if (matric) return fail(400, "Adviser accounts do not carry a matric number.");
  } else if (!matric) {
    return fail(400, "A matric number is required for student and rep accounts.");
  }
  if (matric && overLong(matric)) return fail(400, "That matric number is too long.");

  return {
    ok: true,
    profile: {
      name,
      firstName,
      middleName,
      lastName,
      matric: isAdviser ? null : matric,
      email: tokenEmail,
      institution,
      department,
      level,
      role,
      isRep,
      isAdviser,
    },
  };
}

/**
 * Adviser pre-flight: is this address official for this institution, and is the
 * level still unclaimed? Run BEFORE the profile write so a doomed signup is
 * refused while the user is still on the form, rather than after the account
 * exists. (api/verification.js re-checks the slot inside its own transaction —
 * the authoritative claim — so this is an early warning, not the lock.)
 */
async function checkAdviserEligibility(profile) {
  const domain = profile.email.split("@")[1] || "";
  if (!domain) {
    return { status: 400, error: "That email address is invalid." };
  }

  const check = await isInstitutionDomain(profile.institution, domain);
  // An empty registry is a DEPLOYMENT problem, not a rejected applicant.
  // Answering 403 here would tell every adviser their address is invalid when
  // the truth is that nobody has seeded `institutions` yet.
  if (!check.configured) {
    return {
      status: 503,
      error: "Institution verification is not set up on this deployment yet. Please try again later.",
      code: "REGISTRY_NOT_CONFIGURED",
    };
  }
  if (!check.ok) {
    return {
      status: 403,
      error: "That email is not an official address for this institution. Use your school email, or ask your department to add the domain.",
      code: "DOMAIN_NOT_OFFICIAL",
    };
  }

  const slotRef = db.collection("adviserSlots").doc(
    adviserSlotId(profile.institution, profile.department, profile.level),
  );
  const slotSnap = await slotRef.get();
  if (slotSnap.exists) {
    return {
      status: 409,
      error: `A Level Adviser already exists for ${profile.institution} • ${profile.department} • ${profile.level}.`,
      code: "ADVISER_SLOT_TAKEN",
    };
  }
  return { ok: true, matchedBy: check.matchedBy };
}

async function handleCreateProfile(req, res, decoded) {
  try {
    const built = buildProfile(req.body || {}, decoded);
    if (!built.ok) {
      return res.status(built.status).json({ error: built.error, code: built.code });
    }
    const p = built.profile;

    if (p.isAdviser) {
      const eligible = await checkAdviserEligibility(p);
      if (!eligible.ok) {
        return res.status(eligible.status).json({ error: eligible.error, code: eligible.code });
      }
    }

    const profileRef = db.collection("users").doc(decoded.uid);
    const repSlotRef = p.isRep
      ? db.collection("departmentReps").doc(repSlotId(p.institution, p.department, p.level))
      : null;

    // 🔒 The profile AND the rep-slot claim are written in ONE transaction.
    // Doing them separately would let two simultaneous rep signups both pass the
    // existence check and both believe they are the rep — the classic
    // check-then-act race that app.js previously handled on the client, where a
    // dropped connection could leave the slot claimed with no profile behind it.
    try {
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(profileRef);
        // Idempotent: a retried request must not wipe a profile the user has
        // since edited. 409 tells the client to treat it as "already done".
        if (existing.exists) throw new Error("PROFILE_EXISTS");
        if (repSlotRef) {
          const slot = await tx.get(repSlotRef);
          if (slot.exists) throw new Error("REP_SLOT_TAKEN");
          tx.set(repSlotRef, { repUid: decoded.uid, registeredAt: FieldValue.serverTimestamp() });
        }
        tx.create(profileRef, {
          uid: decoded.uid,
          name: p.name,
          firstName: p.firstName,
          middleName: p.middleName,
          lastName: p.lastName,
          matric: p.matric,
          email: p.email,
          institution: p.institution,
          department: p.department,
          level: p.level,
          // 🔒 SERVER-OWNED. Built here, never read from the request body. An
          // adviser starts as role "adviser" + "pending_email" and can ONLY be
          // promoted to "level_anchor" / "verified" by api/verification.js once
          // the emailed code checks out. See utils/roles.js for why the two
          // adviser values are not interchangeable.
          role: p.role,
          isRep: p.isRep,
          isAdviser: p.isAdviser,
          verificationStatus: p.isAdviser ? VERIFICATION.PENDING_EMAIL : VERIFICATION.NOT_REQUIRED,
          // Written as explicit nulls (not omitted) so the keys always EXIST:
          // firestore.rules pins them with `get('verifiedAt', null) == ...`, and
          // touching a missing key in a rules expression is an ERROR that would
          // deny every later profile edit.
          verifiedAt: null,
          verificationMethod: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (txErr) {
      if (txErr.message === "PROFILE_EXISTS") {
        return res.status(409).json({ error: "This account already has a profile.", code: "PROFILE_EXISTS" });
      }
      if (txErr.message === "REP_SLOT_TAKEN") {
        return res.status(409).json({
          error: `A course representative already exists for ${p.institution} - ${p.department} (${p.level}).`,
          code: "REP_SLOT_TAKEN",
        });
      }
      throw txErr;
    }

    // ---- Adviser: mint and mail the FIRST verification code ----------------
    // Done AFTER the profile commits. A mail failure must not roll back a
    // completed signup — the user can always get a code later via
    // api/verification.js?action=sendCode, and utils/mailer.js never throws.
    let verification = null;
    if (p.isAdviser) {
      const code = codeFor();
      const verRef = db.collection("adviserVerifications").doc(decoded.uid);
      try {
        await verRef.set({
          uid: decoded.uid,
          institutionId: p.institution,
          email: p.email,
          code,
          attempts: 0,
          lastSentAt: Date.now(),
          expiresAt: Date.now() + CODE_TTL_MS,
          createdAt: FieldValue.serverTimestamp(),
        });
        const mail = await sendVerificationCode({
          to: p.email,
          code,
          institutionId: p.institution,
          level: p.level,
          department: p.department,
        });
        // 🔒 The code is NEVER echoed back. It exists only in this document and
        // in the inbox.
        verification = {
          required: true,
          delivery: mail.delivered ? "email" : "not_configured",
          message: mail.delivered
            ? "A 6-digit code is on its way to your school email."
            : "Account created. Email delivery is not configured on this deployment yet — use \"Resend verification\" once an administrator sets it up.",
          expiresInSeconds: CODE_TTL_MS / 1000,
        };
      } catch (verErr) {
        // The account is real and correct; only the code failed. Say so
        // precisely instead of 500-ing a signup the user has already committed
        // to and would then retry into a 409.
        console.error("onboarding: first code failed for", decoded.uid, verErr.message);
        verification = {
          required: true,
          delivery: "failed",
          message: "Account created, but we could not send the code. Use \"Resend verification\" to try again.",
        };
      }
    }

    return res.status(200).json({
      success: true,
      role: p.role,
      isRep: p.isRep,
      isAdviser: p.isAdviser,
      ...(verification ? { verification } : {}),
    });
  } catch (error) {
    console.error("onboarding createProfile error:", error);
    return res.status(500).json({ error: "Unable to create your profile." });
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
      case "createProfile": return handleCreateProfile(req, res, decoded);
      default: return res.status(400).json({ error: "Invalid action. Use: createProfile" });
    }
  } catch (error) {
    console.error("Onboarding API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
