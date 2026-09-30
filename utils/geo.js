// Adsum — server-authoritative time, distance and PIN generation.
//
// Shared by api/attendance.js and api/session.js so the two can never disagree
// about when a PIN was rotated or how far a student is from the hall.

/**
 * 🔒 Read a Firestore timestamp-or-number as epoch milliseconds.
 *
 * THE TRAP THIS EXISTS TO AVOID
 * ----------------------------
 * `FieldValue.serverTimestamp()` is a SENTINEL, not a value. It is only
 * resolved when the document is read back. Doing arithmetic on the sentinel
 * yields NaN, and a NaN age compares false against every threshold — so
 *
 *     const age = Date.now() - secret.pinRotationTime;   // ❌ NaN after a
 *                                                            server write
 *
 * silently makes every freshness check FAIL-OPEN: `isCurrentPinFresh` becomes
 * `NaN < 20000` → false, so the correct PIN is rejected and — worse — the
 * fallback path can be reached in an unintended state. Nothing throws. It
 * simply stops working.
 *
 * The correct read is `.toMillis()`, and this helper is the only place in the
 * codebase allowed to touch the raw field.
 *
 * Handles BOTH shapes so a document written before the migration (a plain
 * number from `Date.now()` on the client) keeps working:
 *   - Firestore Timestamp → `.toMillis()`
 *   - number             → used as-is
 *   - `{ seconds, nanos }` (raw gRPC shape) → converted
 *   - ISO string / Date  → parsed
 *   - null/undefined/garbage → null, meaning "unknown", never NaN
 *
 * @returns {number|null} epoch ms, or null when the value is absent/unusable
 */
function toMillis(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // Firestore Timestamp (Admin SDK) — duck-typed so no import is needed here.
  if (typeof value === "object" && typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  // Raw gRPC shape, which is what a JSON round-trip can produce.
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanos || 0) / 1e6);
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * 🔒 How old a session timestamp is, in ms, measured against the SERVER clock.
 *
 * Returns `fallback` when the stored value is missing or unusable. The caller
 * decides the fallback — for a PIN that means "treat as expired", because an
 * unknown rotation time must never be read as "just rotated".
 */
function ageMs(value, now = Date.now(), fallback = null) {
  const ms = toMillis(value);
  if (ms === null) return fallback;
  return now - ms;
}

/**
 * 🌍 Great-circle distance in metres between two lat/lon pairs.
 *
 * Used for the server-side geofence. A flat euclidean approximation is wrong
 * at this scale: 1° of longitude is ~111 km at the equator but the calculation
 * below stays accurate enough (well under a metre of error at campus scale).
 */
function haversineMetres(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const R = 6371000; // mean Earth radius, metres
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  // ⚠️ The second argument is sqrt(1 - a), NOT sqrt(sqrt(a)). Writing the
  // latter is a silent copy error that inflates every distance by ~10.6x: an
  // 80m radius would quietly behave as 850m, and the geofence would pass
  // students who are nowhere near the hall. Verified against the known
  // 1°-of-latitude ≈ 111.2 km figure.
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Are these usable coordinates? Rejects NaN, null and out-of-range values. */
function isValidCoord(lat, lon) {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180
  );
}

/**
 * Cryptographically-seeded 4-digit PIN.
 *
 * `Math.random()` is not for secrets: its output is predictable from a handful
 * of observed values, and a predictable PIN defeats the whole anti-relay engine.
 * A rep watching one rotation can then predict the next ones.
 */
const crypto = require("crypto");
function generatePin(digits = 4) {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, "0");
}

module.exports = { toMillis, ageMs, haversineMetres, isValidCoord, generatePin };
