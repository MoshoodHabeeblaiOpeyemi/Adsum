// VeriPresenX — institution ↔ official email-domain registry.
//
// Shared by api/verification.js and api/onboarding.js so the two can never
// disagree about which addresses count as "staff".
//
// The registry is SERVER-OWNED data in Firestore. The client sends the
// institution id it picked; it never sends the list of acceptable domains, so a
// tampered client cannot widen its own allowlist.
//
// Seeding (pilot):
//   institutions/{CODE}          -> { name, code, aliases[], emailDomains[] }
//   universityDomains/{CODE}     -> { domains[] }        (legacy seed shape)
//
// Example:
//   institutions/UNILORIN = {
//     name: "University of Ilorin",
//     code: "UNILORIN",
//     aliases: ["UNILORIN", "UNILORIN UNIVERSITY"],
//     emailDomains: ["unilorin.edu.ng"]
//   }
//
// Lookup is by id, then by `code`, `name` or alias so the client can send
// whichever identifier it happens to have.

const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

try {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  }
} catch (e) {
  if (!/already exists/.test(e.message)) console.error("Init error:", e);
}

const db = getFirestore();
const norm = (v) => String(v || "").trim().toUpperCase();

const REGISTRY_SCAN_LIMIT = 300;

/** Pull a usable domain list out of either supported document shape. */
function domainsOf(data) {
  if (!data) return [];
  const list = data.emailDomains || data.domains || [];
  if (!Array.isArray(list)) return [];
  return list.map((d) => String(d).trim().toLowerCase()).filter(Boolean);
}

const keyMatches = (data, wanted) =>
  norm(data.code) === wanted ||
  norm(data.name) === wanted ||
  (Array.isArray(data.aliases) && data.aliases.some((a) => norm(a) === wanted));

/**
 * Is `domain` an official address domain for this institution?
 * @returns {Promise<{ok: boolean, configured: boolean, matchedBy?: string}>}
 *   `configured:false` means NO registry documents exist at all — a deployment
 *   problem the caller should surface, not silently treat as "not official".
 */
async function isInstitutionDomain(institutionId, domain) {
  const wantedDomain = String(domain || "").trim().toLowerCase();
  const wantedId = norm(institutionId);
  if (!wantedDomain || !wantedId) return { ok: false, configured: false };

  // 1. Direct hit on the id the client sent.
  const inst = await db.collection("institutions").doc(wantedId).get();
  if (inst.exists && domainsOf(inst.data()).includes(wantedDomain)) {
    return { ok: true, configured: true, matchedBy: "institutions/id" };
  }
  const legacy = await db.collection("universityDomains").doc(wantedId).get();
  if (legacy.exists && domainsOf(legacy.data()).includes(wantedDomain)) {
    return { ok: true, configured: true, matchedBy: "universityDomains/id" };
  }

  // 2. The client may hold a display name or a different code — match on
  //    code / name / alias instead. The registry is small and admin-written,
  //    so a bounded scan is cheaper than another round trip to the client.
  const snap = await db.collection("institutions").limit(REGISTRY_SCAN_LIMIT).get();
  for (const doc of snap.docs) {
    if (keyMatches(doc.data(), wantedId) && domainsOf(doc.data()).includes(wantedDomain)) {
      return { ok: true, configured: true, matchedBy: `institutions/${doc.id}` };
    }
  }

  // 3. Say whether the registry is simply empty, so the API can return a
  //    503 "not configured" instead of a misleading 403 "not official".
  const anyDoc = await db.collection("institutions").limit(1).get();
  return { ok: false, configured: !anyDoc.empty };
}

module.exports = { isInstitutionDomain };
