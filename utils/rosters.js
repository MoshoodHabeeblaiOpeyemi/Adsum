// VeriPresenX — the ONE definition of a level roster's identity.
//
// A roster is addressed by (institution, department, level) — all free-text
// fields on a profile. api/roster.js writes the document and api/onboarding.js
// reads it during Phase 5 signup, and the two MUST derive the same id or the rep
// check silently consults a document that does not exist.
//
// Extracted here because "where is the roster for this level?" is exactly the
// kind of question that gets answered twice, differently.

const norm = (v) => String(v || "").trim().toUpperCase();

/**
 * Collapse the spacing people vary inside a field, so "200 L", "200L" and
 * "200  L" are one level rather than three.
 *
 * This is not cosmetic. A level is free text on BOTH sides of the trust chain:
 * the adviser types it when importing, the student types it when signing up. If
 * those two normalise differently they address different roster documents, and
 * the rep check silently finds nothing — a rep who WAS chosen would be refused,
 * with no error anywhere to explain why.
 */
const normSegment = (v) => norm(v).replace(/[\s._-]+/g, "");

/**
 * The document id for a level roster. Segments are normalised and then any
 * character that is illegal in a document id is replaced, so two spellings of
 * the same level collide deliberately rather than producing two rosters.
 */
const rosterDocId = (institution, department, level) =>
  `${normSegment(institution)}_${normSegment(department)}_${normSegment(level)}`.replace(/[^A-Z0-9_]/g, "_");

/**
 * Look up the roster covering a student's own (institution, department, level).
 * Returns null when the level has no roster — an ordinary state, not an error:
 * it just means the adviser has not imported it yet.
 */
async function findRosterFor(db, { institution, department, level }) {
  const ref = db.collection("departmentRosters").doc(rosterDocId(institution, department, level));
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { ref, id: ref.id, data: snap.data() };
}

module.exports = { norm, normSegment, rosterDocId, findRosterFor };
