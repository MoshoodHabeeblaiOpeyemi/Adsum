const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");
const { isInstitutionDomain } = require("../utils/institutions");
const { sendVerificationCode } = require("../utils/mailer");
const {
  ROLE,
  VERIFICATION,
  isVerifiedAdviser,
  isPendingAdviser,
} = require("../utils/roles");
const crypto = require("crypto");

try {
  if (getApps().length === 0) {
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
  }
} catch (error) {
  if (!/already exists/.test(error.message))
    console.error("Firebase Admin Init Error:", error);
}

const db = getFirestore();
const norm = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const codeFor = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

function safeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++)
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function isAdviserProfile(profile) {
  return isPendingAdviser(profile) || profile?.role === ROLE.LEVEL_ANCHOR;
}

function verificationCollection(profile) {
  return isAdviserProfile(profile)
    ? "adviserVerifications"
    : "emailVerifications";
}

function accountCanVerify(profile) {
  return (
    isAdviserProfile(profile) ||
    [ROLE.STUDENT, ROLE.REP].includes(profile?.role)
  );
}

async function handleSendCode(req, res, decoded) {
  try {
    const profileRef = db.collection("users").doc(decoded.uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists)
      return res.status(404).json({ error: "Profile not found." });
    const profile = profileSnap.data();
    const cleanEmail = String(profile.email || "")
      .trim()
      .toLowerCase();
    const tokenEmail = String(decoded.email || "")
      .trim()
      .toLowerCase();
    const domain = cleanEmail.split("@")[1] || "";

    if (!accountCanVerify(profile))
      return res
        .status(403)
        .json({ error: "This account cannot request email verification." });
    if (!domain || cleanEmail !== tokenEmail)
      return res
        .status(403)
        .json({
          error:
            "The email on this account does not match your signed-in address.",
        });
    if (
      decoded.email_verified === true &&
      profile.verificationStatus === VERIFICATION.VERIFIED
    ) {
      return res.status(200).json({ success: true, alreadyVerified: true });
    }

    const adviser = isAdviserProfile(profile);
    if (adviser) {
      const domainStatus = await isInstitutionDomain(
        profile.institution,
        domain,
      );
      if (!domainStatus.configured)
        return res
          .status(503)
          .json({ error: "Institution email domains are not configured yet." });
      if (!domainStatus.ok)
        return res
          .status(403)
          .json({ error: "Use an email domain listed for your institution." });

      const slotId =
        `adviser_${norm(profile.institution)}_${norm(profile.department)}_${norm(profile.level)}`.replace(
          /[^A-Z0-9_]/g,
          "_",
        );
      const slotSnap = await db.collection("adviserSlots").doc(slotId).get();
      if (slotSnap.exists && slotSnap.data().adviserUid !== decoded.uid) {
        return res
          .status(409)
          .json({
            error: `A Level Adviser already exists for ${profile.institution} • ${profile.department} • ${profile.level}.`,
          });
      }
    }

    const verRef = db
      .collection(verificationCollection(profile))
      .doc(decoded.uid);
    const existing = await verRef.get();
    if (existing.exists) {
      const data = existing.data();
      const retryAfterSeconds = Math.ceil(
        (data.lastSentAt + RESEND_COOLDOWN_MS - Date.now()) / 1000,
      );
      if (retryAfterSeconds > 0) {
        return res
          .status(429)
          .json({
            error: "Please wait before requesting another code.",
            retryAfterSeconds,
          });
      }
    }

    const code = codeFor();
    await verRef.set({
      uid: decoded.uid,
      institutionId: norm(profile.institution),
      email: cleanEmail,
      code,
      attempts: 0,
      lastSentAt: Date.now(),
      expiresAt: Date.now() + CODE_TTL_MS,
      createdAt: FieldValue.serverTimestamp(),
    });
    const mail = await sendVerificationCode({
      to: cleanEmail,
      code,
      institutionId: norm(profile.institution),
      level: adviser ? profile.level : null,
      department: adviser ? profile.department : null,
      accountType: adviser ? "Level Adviser" : "student",
    });

    return res.status(200).json({
      success: true,
      delivery: mail.delivered ? "email" : "not_configured",
      message: mail.delivered
        ? "A 6-digit code is on its way to your email. Check your Spam folder if it does not arrive shortly."
        : "Email delivery is not configured on this deployment.",
      expiresInSeconds: CODE_TTL_MS / 1000,
    });
  } catch (error) {
    console.error("verification sendCode error:", error);
    return res.status(500).json({ error: "Unable to send verification code." });
  }
}

async function handleVerifyCode(req, res, decoded) {
  try {
    const code = String((req.body || {}).code || "").trim();
    if (!/^\d{6}$/.test(code))
      return res.status(400).json({ error: "Enter the 6-digit code." });

    const profileRef = db.collection("users").doc(decoded.uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists)
      return res.status(404).json({ error: "Profile not found." });
    const profile = profileSnap.data();
    const adviser = isAdviserProfile(profile);
    const tokenEmail = String(decoded.email || "")
      .trim()
      .toLowerCase();
    const profileEmail = String(profile.email || "")
      .trim()
      .toLowerCase();
    if (
      !accountCanVerify(profile) ||
      !profileEmail ||
      tokenEmail !== profileEmail
    ) {
      return res
        .status(403)
        .json({
          error:
            "The email on this account does not match your signed-in address.",
        });
    }

    const verRef = db
      .collection(verificationCollection(profile))
      .doc(decoded.uid);
    const verSnap = await verRef.get();
    if (!verSnap.exists)
      return res
        .status(400)
        .json({ error: "No verification code found. Request a new one." });
    const verification = verSnap.data();
    if (
      String(verification.email || "")
        .trim()
        .toLowerCase() !== profileEmail
    ) {
      return res
        .status(403)
        .json({ error: "This code was issued for a different email address." });
    }
    if (Date.now() > (verification.expiresAt || 0)) {
      await verRef.delete();
      return res
        .status(410)
        .json({ error: "Code expired. Request a new one." });
    }
    if ((verification.attempts || 0) >= MAX_ATTEMPTS) {
      await verRef.delete();
      return res
        .status(429)
        .json({ error: "Too many incorrect attempts. Request a fresh code." });
    }
    if (!safeEqual(verification.code, code)) {
      await verRef.update({ attempts: FieldValue.increment(1) });
      const attemptsLeft = Math.max(
        0,
        MAX_ATTEMPTS - ((verification.attempts || 0) + 1),
      );
      return res
        .status(403)
        .json({ error: `Incorrect code. ${attemptsLeft} attempts left.` });
    }

    await getAuth().updateUser(decoded.uid, { emailVerified: true });
    if (adviser) {
      const slotId =
        `adviser_${norm(profile.institution)}_${norm(profile.department)}_${norm(profile.level)}`.replace(
          /[^A-Z0-9_]/g,
          "_",
        );
      const slotRef = db.collection("adviserSlots").doc(slotId);
      await db.runTransaction(async (tx) => {
        const [slotSnapLatest, codeSnapLatest] = await Promise.all([
          tx.get(slotRef),
          tx.get(verRef),
        ]);
        if (
          !codeSnapLatest.exists ||
          !safeEqual(codeSnapLatest.data().code, code) ||
          Date.now() > (codeSnapLatest.data().expiresAt || 0)
        ) {
          throw new Error("VERIFICATION_CODE_CHANGED");
        }
        if (
          slotSnapLatest.exists &&
          slotSnapLatest.data().adviserUid !== decoded.uid
        ) {
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
        tx.update(profileRef, {
          role: ROLE.LEVEL_ANCHOR,
          verificationStatus: VERIFICATION.VERIFIED,
          verifiedAt: FieldValue.serverTimestamp(),
          verificationMethod: "university_email",
        });
        tx.delete(verRef);
      });
    } else {
      await db.runTransaction(async (tx) => {
        const [codeSnapLatest, profileSnapLatest] = await Promise.all([
          tx.get(verRef),
          tx.get(profileRef),
        ]);
        if (
          !codeSnapLatest.exists ||
          !profileSnapLatest.exists ||
          !safeEqual(codeSnapLatest.data().code, code) ||
          Date.now() > (codeSnapLatest.data().expiresAt || 0)
        ) {
          throw new Error("VERIFICATION_CODE_CHANGED");
        }
        tx.update(profileRef, {
          verificationStatus: VERIFICATION.VERIFIED,
          verifiedAt: FieldValue.serverTimestamp(),
          verificationMethod: "email_code",
        });
        tx.delete(verRef);
      });
    }

    return res.status(200).json({
      success: true,
      message: "Email verified.",
      adviser,
      role: adviser ? ROLE.LEVEL_ANCHOR : profile.role,
    });
  } catch (error) {
    if (error.message === "ADVISER_SLOT_TAKEN") {
      return res
        .status(409)
        .json({
          error:
            "A Level Adviser already exists for this department and level.",
        });
    }
    if (error.message === "VERIFICATION_CODE_CHANGED") {
      return res
        .status(409)
        .json({
          error: "That code was already used or expired. Request a new code.",
        });
    }
    console.error("verification verifyCode error:", error);
    return res.status(500).json({ error: "Unable to verify code." });
  }
}

async function handleVerifyNIN(req, res) {
  return res.status(501).json({
    error:
      "NIN verification is available after the pilot — pending provider onboarding.",
    code: "NIN_NOT_AVAILABLE",
  });
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
    switch (req.query.action) {
      case "sendCode":
        return handleSendCode(req, res, decoded);
      case "verifyCode":
        return handleVerifyCode(req, res, decoded);
      case "verifyNIN":
        return handleVerifyNIN(req, res);
      default:
        return res.status(400).json({ error: "Invalid action." });
    }
  } catch (error) {
    console.error("Verification API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
