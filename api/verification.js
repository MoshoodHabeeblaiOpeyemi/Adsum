const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");
const { ROLE, VERIFICATION, isVerifiedAdviser, isPendingAdviser } = require("../utils/roles");

try {
  if (getApps().length === 0) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
} catch (e) { if (!/already exists/.test(e.message)) console.error("Init error:", e); }

const db = getFirestore();
const norm = (v) => String(v || "").trim().toUpperCase();
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // min gap between code sends per account

// Cryptographically-seeded 6-digit code (Math.random is not for secrets).
const crypto = require("crypto");
const codeFor = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

/** Constant-time string compare so a wrong code cannot be probed by timing. */
function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/**
 * Is this email domain official for the institution? Accepts BOTH seed shapes:
 *   universityDomains/{institutionId} -> { domains: [...] }
 *   institutions/{institutionId}      -> { emailDomains: [...] }
 */
async function isInstitutionDomain(institutionId, domain) {
  const wanted = String(domain || "").trim().toLowerCase();
  if (!wanted) return false;

  const udSnap = await db.collection("universityDomains").doc(String(institutionId)).get();
  if (udSnap.exists) {
    const list = udSnap.data().domains || udSnap.data().emailDomains || [];
    if (list.map((d) => String(d).trim().toLowerCase()).includes(wanted)) return true;
  }

  const instSnap = await db.collection("institutions").doc(String(institutionId)).get();
  if (instSnap.exists) {
    const list = instSnap.data().emailDomains || instSnap.data().domains || [];
    if (list.map((d) => String(d).trim().toLowerCase()).includes(wanted)) return true;
  }

  return false;
}

/**
 * Sends the 6-digit code through Resend's HTTPS API (no extra SDK needed).
 * When it is not configured we return NOT_CONFIGURED so the client can fall
 * back to Firebase's provider-less verification link instead of dead-ending.
 */
async function deliverCode({ to, code, institutionId }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VERIFICATION_FROM_EMAIL;
  if (!apiKey || !from) return { delivered: false, reason: "NOT_CONFIGURED" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Your VeriPresenX verification code",
      text:
        `Your VeriPresenX verification code is ${code}.\n\n` +
        `It expires in 10 minutes. Institution: ${institutionId}\n` +
        `If you did not request this, ignore this email.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Resend delivery failed:", res.status, body);
    return { delivered: false, reason: "SEND_FAILED" };
  }
  return { delivered: true };
}

async function loadAdviserProfile(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return { snap, profile: snap.exists ? snap.data() : null };
}

async function handleSendCode(req, res, decoded) {
  try {
    const { institutionId, email } = req.body || {};
    if (!institutionId || !email) return res.status(400).json({ error: "institutionId and email are required." });
    const cleanEmail = String(email).trim().toLowerCase();
    const domain = cleanEmail.split("@")[1] || "";
    if (!domain) return res.status(400).json({ error: "That email address is invalid." });
    const profileSnap = await db.collection("users").doc(decoded.uid).get();
    if (!profileSnap.exists) return res.status(404).json({ error: "Profile not found." });
    const profile = profileSnap.data();
    // Order matters: check "already verified" BEFORE the role gate. Once an
    // adviser completes the code check their `role` is promoted to
    // "level_anchor", so testing `role !== "adviser"` first would reject a
    // perfectly valid already-verified adviser with a confusing 403 instead of
    // the friendly idempotent 200.
    // 🔒 `isVerifiedAdviser` (utils/roles.js) is the ONLY correct test here. A
    // gate written as `role === "adviser"` would accept every UNVERIFIED
    // applicant, which is the opposite of what this endpoint is for.
    if (isVerifiedAdviser(profile)) {
      return res.status(200).json({ success: true, alreadyVerified: true });
    }
    // Only an account genuinely awaiting a code may request one. This also
    // stops a student or rep from driving the 6-digit code machinery at all.
    if (!isPendingAdviser(profile)) {
      return res.status(403).json({ error: "Only Level Adviser accounts use email-code verification." });
    }

    // Domain must be official for THIS institution (universityDomains first,
    // then the institution record — both seed shapes are supported).
    const allowed = await isInstitutionDomain(institutionId, domain);
    if (!allowed) {
      return res.status(403).json({
        error: "That email is not an official address for this institution. Use your school email, or ask your department to add the domain.",
      });
    }

    // Only ONE adviser per (institution, department, level) — the trust rule.
    const slotId = `adviser_${norm(profile.institution)}_${norm(profile.department)}_${norm(profile.level)}`
      .replace(/[^A-Z0-9_]/g, "_");
    const slotRef = db.collection("adviserSlots").doc(slotId);
    const slotSnap = await slotRef.get();
    if (slotSnap.exists && slotSnap.data().adviserUid !== decoded.uid) {
      return res.status(409).json({
        error: `A Level Adviser already exists for ${profile.institution} • ${profile.department} • ${profile.level}.`,
      });
    }

    const verRef = db.collection("adviserVerifications").doc(decoded.uid);
    const existing = await verRef.get();
    if (existing.exists) {
      const last = existing.data().lastSentAt || 0;
      if (Date.now() - last < RESEND_COOLDOWN_MS) {
        return res.status(429).json({ error: "Please wait a minute before requesting another code." });
      }
      if ((existing.data().attempts || 0) >= MAX_ATTEMPTS) {
        await verRef.delete();
        return res.status(429).json({ error: "Too many incorrect attempts. Request a fresh code." });
      }
    }

    const code = codeFor();
    await verRef.set({
      uid: decoded.uid,
      institutionId: String(institutionId),
      email: cleanEmail,
      code,
      attempts: 0,
      lastSentAt: Date.now(),
      expiresAt: Date.now() + CODE_TTL_MS,
      createdAt: FieldValue.serverTimestamp(),
    });

    const mail = await deliverCode({ to: cleanEmail, code, institutionId });

    // 🔒 The code is NEVER echoed back — it only ever exists in the emailed
    // message and in this server-side document.
    return res.status(200).json({
      success: true,
      message: mail.delivered
        ? "A 6-digit code is on its way to your school email. If you don't see it within a minute, check your Spam folder and mark it as 'Not Spam'."
        : "Code created. Email delivery is not configured yet on this deployment.",
      delivery: mail.delivered ? "email" : "not_configured",
      expiresInSeconds: CODE_TTL_MS / 1000,
    });
  } catch (error) {
    console.error("verification sendCode error:", error);
    return res.status(500).json({ error: "Unable to send verification code." });
  }
}

async function handleVerifyCode(req, res, decoded) {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code is required." });
    const verRef = db.collection("adviserVerifications").doc(decoded.uid);
    const verSnap = await verRef.get();
    if (!verSnap.exists) return res.status(400).json({ error: "No verification code found. Request a new one." });
    const ver = verSnap.data();
    if (Date.now() > (ver.expiresAt || 0)) {
      await verRef.delete();
      return res.status(410).json({ error: "Code expired. Request a new one." });
    }
    if ((ver.attempts || 0) >= MAX_ATTEMPTS) {
      await verRef.delete();
      return res.status(429).json({ error: "Too many incorrect attempts. Request a fresh code." });
    }
    if (!safeEqual(ver.code, String(code).trim())) {
      await verRef.update({ attempts: FieldValue.increment(1) });
      const left = MAX_ATTEMPTS - ((ver.attempts || 0) + 1);
      return res.status(403).json({
        error: `Incorrect code. ${left > 0 ? `${left} attempt${left === 1 ? "" : "s"} left.` : ""}`.trim(),
      });
    }
    // The profile is re-read here (never trusted from the request body) because
    // the adviser slot id is derived from the SERVER's copy of institution /
    // department / level.
    const { profile } = await loadAdviserProfile(decoded.uid);
    if (!profile) return res.status(404).json({ error: "Profile not found." });

    // 🔒 Claim the adviser slot + verify the account in ONE transaction so a
    // second adviser can never slip in between the check and the write.
    const slotId = `adviser_${norm(profile.institution)}_${norm(profile.department)}_${norm(profile.level)}`
      .replace(/[^A-Z0-9_]/g, "_");
    const slotRef = db.collection("adviserSlots").doc(slotId);
    try {
      await db.runTransaction(async (tx) => {
        const slot = await tx.get(slotRef);
        if (slot.exists && slot.data().adviserUid !== decoded.uid) {
          throw new Error("ADVISER_SLOT_TAKEN");
        }
        tx.set(
          slotRef,
          {
            adviserUid: decoded.uid,
            institution: profile.institution || null,
            department: profile.department || null,
            level: profile.level || null,
            claimedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        tx.update(db.collection("users").doc(decoded.uid), {
          // 🔒 The promotion. These three values are written ONLY here, on the
          // Admin SDK, which bypasses firestore.rules. They are the entire
          // basis of adviser authorisation for the rest of the app, which is
          // why every gate reads them through utils/roles.js.
          role: ROLE.LEVEL_ANCHOR,
          verificationStatus: VERIFICATION.VERIFIED,
          verifiedAt: FieldValue.serverTimestamp(),
          verificationMethod: "university_email",
        });
        tx.delete(verRef);
      });
    } catch (txErr) {
      if (txErr.message === "ADVISER_SLOT_TAKEN") {
        return res.status(409).json({
          error: `A Level Adviser already exists for ${profile.institution} • ${profile.department} • ${profile.level}.`,
        });
      }
      throw txErr;
    }
    return res.status(200).json({
      success: true,
      message: "Adviser verified.",
      role: ROLE.LEVEL_ANCHOR,
    });
  } catch (error) {
    console.error("verification verifyCode error:", error);
    return res.status(500).json({ error: "Unable to verify code." });
  }
}

async function handleVerifyNIN(req, res) {
  // 🚧 Deliberate stub for the pilot. NIN + selfie is a paid third-party
  // provider (VerifyMe / Dojah / YouID) that we onboard AFTER the pilot.
  // Nothing in the app depends on this path working.
  return res.status(501).json({
    error: "NIN verification is available after the pilot — pending provider onboarding.",
    code: "NIN_NOT_AVAILABLE",
  });
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
      case "sendCode": return handleSendCode(req, res, decoded);
      case "verifyCode": return handleVerifyCode(req, res, decoded);
      case "verifyNIN": return handleVerifyNIN(req, res);
      default: return res.status(400).json({ error: "Invalid action. Use: sendCode, verifyCode, verifyNIN" });
    }
  } catch (error) {
    console.error("Verification API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
