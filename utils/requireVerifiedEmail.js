// Require the Firebase Auth email_verified claim for app data and actions.
// Signup and email-verification endpoints intentionally do not use this guard.
module.exports = function requireVerifiedEmail(decoded, res) {
  if (decoded && decoded.email_verified === true) return true;
  res.status(403).json({
    error: "Verify your email address before using Adsum.",
    emailNotVerified: true,
  });
  return false;
};
