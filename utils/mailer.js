// Adsum — adviser verification mail (Resend over plain HTTPS, no SDK).
//
// Shared by api/verification.js (resend / retry a code) and api/onboarding.js
// (send the very first code at signup). Keeping one implementation means the
// "not configured" contract can never drift between the two.
//
// Contract: NEVER throws. It returns a result object so a caller can degrade
// gracefully instead of 500-ing a signup the user has already committed to.

/**
 * @returns {Promise<{delivered: boolean, reason?: string}>}
 *   delivered:false + reason "NOT_CONFIGURED" when the env keys are absent.
 */
async function sendVerificationCode({ to, code, institutionId, level, department }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VERIFICATION_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn(
      "Verification email skipped: RESEND_API_KEY / VERIFICATION_FROM_EMAIL are not set.",
    );
    return { delivered: false, reason: "NOT_CONFIGURED" };
  }

  const scope = [institutionId, department, level].filter(Boolean).join(" — ");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Your Adsum adviser verification code",
        text:
          `Your Adsum verification code is ${code}\n\n` +
          `Level: ${scope || "your department"}\n` +
          `It expires in 10 minutes. Enter it in the app to activate your\n` +
          `Level Adviser account.\n\n` +
          `If you did not request this, ignore this email — nothing happens\n` +
          `until the code is entered.`,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Resend delivery failed:", res.status, body);
      return { delivered: false, reason: "SEND_FAILED" };
    }
    return { delivered: true };
  } catch (err) {
    // A DNS/timeout failure must not block the account from being created.
    console.error("Resend transport error:", err.message);
    return { delivered: false, reason: "TRANSPORT_ERROR" };
  }
}

module.exports = { sendVerificationCode };
