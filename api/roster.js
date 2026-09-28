// VeriPresenX — adviser roster management (Phase 4).
//
// The trust chain, in three backend moves:
//   1. adviser imports the level's master list        → this file, importLevelRoster
//   2. adviser names ONE rep from that list           → this file, chooseRep
//   3. a student signs up and is checked against it   → api/onboarding.js (Phase 5)
//
// WHY A ROSTER AT ALL
// --------------------
// Today anyone can sign up and call themselves a rep; the slot is won by
// arriving first (app.js still does a client-side `REP_SLOT_TAKEN` race). The
// roster is what makes rephood a GRANT by an adviser rather than a CLAIM by a
// speedrunner, and it is also the student-side allow-list for Phase 6.
//
// AUTHORISATION
// -------------
// 🔒 Every action requires `isVerifiedAdviser()` — NOT `role === "adviser"`,
// which is the value held by every unverified applicant (see utils/roles.js).
// The adviser scope is then taken from the SERVER'S copy of the profile, never
// from the request body, so an adviser cannot address someone else's roster.
//
// A roster is keyed on the adviser's own (institution, department, level), so
// `institutionId`/`departmentId`/`levelCode` are NOT accepted as parameters at
// all. That removes a whole class of horizontal-privilege bug: there is no
// input to tamper with.

const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");
const { isVerifiedAdviser, ROLE } = require("../utils/roles");
const { parseRosterCsv } = require("../utils/csv");

try {
  if (getApps().length === 0) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
} catch (e) { if (!/already exists/.test(e.message)) console.error("Init error:", e); }

const db = getFirestore();
const norm = (v) => String(v || "").trim().toUpperCase();

// Cap the students returned in one preview page. A level roster is small
// (tens), but this must not become an unbounded read on a malformed import.
const PREVIEW_LIMIT = 200;

// The roster is the adviser's scope. Reading it from the profile — not the
// body — is what stops one adviser reading or writing another's roster.
async function loadAdviserScope(uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return { error: { status: 404, body: { error: "Profile not found." } } };
  const profile = snap.data();

  // 🔒 The one gate. Fails closed on a partial or legacy profile.
  if (!isVerifiedAdviser(profile)) {
    return {
      error: {
        status: 403,
        body: {
          error: "Only a verified Level Adviser can manage a level roster.",
          code: "NOT_VERIFIED_ADVISER",
        },
      },
    };
  }

  return {
    profile,
    institution: norm(profile.institution),
    department: norm(profile.department),
    level: norm(profile.level),
  };
}


/**
 * The roster document id. Delegated to utils/rosters.js so this writer and
 * api/onboarding.js's Phase 5 reader can never derive different ids for the
 * same level — a mismatch would make a taken rep look free.
 */
const { rosterDocId } = require("../utils/rosters");

/**
 * Import (or re-import) the level master list.
 *
 * Two-phase on purpose: without `commit: true` it parses and reports counts
 * without writing, and only a confirmed call stores anything. An import can
 * drop the rep selection (the old list may not contain the old rep), so making
 * the adviser confirm the real numbers is the difference between a roster and a
 * guess.
 */
async function handleImportRoster(req, res, decoded) {
  try {
    const scope = await loadAdviserScope(decoded.uid);
    if (scope.error) return res.status(scope.error.status).json(scope.error.body);

    const { csv, commit } = req.body || {};
    if (typeof csv !== "string" || !csv.trim()) {
      return res.status(400).json({ error: "No CSV content received. Re-upload the file.", code: "NO_CSV" });
    }

    const parsed = parseRosterCsv(csv);

    // 🔒 All-or-nothing. A partial import is the worst outcome: the adviser is
    // shown a count, believes everyone is enrolled, and the missing students
    // are only discovered when they fail to check in.
    if (parsed.errors.length) {
      return res.status(400).json({
        error: `Nothing was imported — fix ${parsed.errors.length} problem${parsed.errors.length === 1 ? "" : "s"} in the file and try again.`,
        code: "INVALID_CSV",
        errors: parsed.errors.slice(0, 25),
        errorCount: parsed.errors.length,
        warnings: parsed.warnings.slice(0, 25),
      });
    }

    const rosterRef = db.collection("departmentRosters").doc(
      rosterDocId(scope.institution, scope.department, scope.level),
    );
    const existingSnap = await rosterRef.get();
    const previous = existingSnap.exists ? existingSnap.data() : null;
    const previousCount = Array.isArray(previous?.matrics) ? previous.matrics.length : 0;
    const newCount = parsed.students.length;
    // "Duplicates" = students already on the roster, so a re-import reports
    // honestly instead of implying a fresh list.
    const carriedOver = previous ? parsed.students.filter((s) => previous.matrics.includes(s.matric)).length : 0;
    const added = newCount - carriedOver;

    if (!commit) {
      return res.status(200).json({
        dryRun: true,
        total: newCount,
        added,
        duplicates: carriedOver,
        replaced: previousCount,
        warnings: parsed.warnings,
        preview: parsed.students.slice(0, PREVIEW_LIMIT),
        truncated: newCount > PREVIEW_LIMIT,
      });
    }

    // The rep is a MEMBER of the roster. If the chosen rep is absent from the
    // new list the selection is dropped rather than silently kept — a rep who
    // is not on the level roster is exactly the state this feature exists to
    // prevent. Reported back so the UI can say so out loud.
    const repSurvives =
      Boolean(previous?.chosenRepMatric) && parsed.students.some((s) => s.matric === previous.chosenRepMatric);

    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(rosterRef, {
      institution: scope.institution,
      department: scope.department,
      level: scope.level,
      adviserUid: decoded.uid,
      students: parsed.students,
      matrics: parsed.students.map((s) => s.matric),
      count: newCount,
      // Set only by `chooseRep`; cleared here when the rep is no longer on the
      // list. Never taken from the request body.
      chosenRepMatric: repSurvives ? previous.chosenRepMatric : null,
      chosenRepUid: repSurvives ? previous.chosenRepUid || null : null,
      chosenRepName: repSurvives ? previous.chosenRepName || null : null,
      chosenRepAt: repSurvives ? previous.chosenRepAt || null : null,
      // A re-import is a roster change, so it belongs in the same trail. The
      // rep history survives a re-import — dropping a student is not the same
      // as forgetting who the rep was.
      repChanges: appendRepChange(previous?.repChanges, {
        action: "reimport",
        previousMatric: previous?.chosenRepMatric || null,
        previousName: previous?.chosenRepName || null,
        matric: repSurvives ? previous.chosenRepMatric : null,
        name: repSurvives ? previous.chosenRepName || null : null,
        count: newCount,
        at: Timestamp.now(),
        by: decoded.uid,
      }),
      importedAt: now,
      previousCount,
    });
    await batch.commit();

    return res.status(200).json({
      success: true,
      total: newCount,
      added,
      duplicates: carriedOver,
      replaced: previousCount,
      repDropped: Boolean(previous?.chosenRepMatric) && !repSurvives,
      repMatric: repSurvives ? previous.chosenRepMatric : null,
      warnings: parsed.warnings,
    });
  } catch (error) {
    // 🔎 Why this exists: the adviser saw "Unable to import the roster." for
    // EVERY failure, so a wrong-column file, a rules problem and a quota limit
    // were indistinguishable. Worse, when the code below guessed wrong it told
    // them to "check your connection" for a server fault that retrying could
    // never fix.
    //
    // The Firestore status CODE is safe to return — it is a fixed enum
    // ("permission-denied", "unavailable", "not-found"…), not a document path.
    // The MESSAGE is never returned, because it embeds collection names and
    // document ids, which is a free schema map for an attacker.
    const code = (error && error.code) || null;
    const msg = String((error && error.message) || "");
    console.error("roster import error:", error);
    console.error("  firestore code:", code, "| message:", msg);

    const isPermission = code === 7 || /permission|insufficient/i.test(msg);
    const isQuota = /exceed|quota|rate|resource-exhausted/i.test(msg) || code === 8;
    const isBadValue = /invalid|undefined|unsupported|out of range/i.test(msg) || code === 3;
    const isUnavailable = code === 14 || /unavailable|deadline|network|ECONN/i.test(msg);

    if (isPermission) console.error("  -> rules/permission problem on the roster document");
    if (isQuota) console.error("  -> quota or rate limit");
    if (isBadValue) console.error("  -> a field value Firestore cannot store");
    if (isUnavailable) console.error("  -> Firestore unreachable from this function");

    return res.status(500).json({
      error: "Unable to save the roster. Your file was read fine — nothing has been saved.",
      code: "IMPORT_WRITE_FAILED",
      // The raw status, so the client can show something specific. Safe: a fixed
      // enum, not a path.
      firestoreCode: code,
      reason: isPermission
        ? "The database rejected the write. An administrator needs to check the Firestore rules."
        : isQuota
          ? "The server is busy. Wait a moment, then press Confirm again."
          : isBadValue
            ? "The server could not store the roster data. An administrator needs to look at this."
            : isUnavailable
              ? "The server could not reach the database. Check the connection and press Confirm again."
              : "Unexpected server error. An administrator needs to check the logs.",
    });
  }
}


/** Cap the rep-change audit trail. Firestore bills by document size, and a
 *  long-lived roster must not grow without limit. */
const REP_CHANGE_LIMIT = 50;

/** Append to the audit trail, newest last, trimming the oldest when full. */
function appendRepChange(existing, entry) {
  const list = Array.isArray(existing) ? existing.slice() : [];
  list.push(entry);
  return list.slice(-REP_CHANGE_LIMIT);
}

/**
 * Name ONE rep for this level, chosen by the adviser from the imported roster.
 *
 * This is the whole point of Phase 4: the rep badge becomes something the
 * adviser GRANTS. `clear: true` steps it down again (a rep can stand down, or
 * an adviser can be replaced); otherwise the matric must already exist on the
 * roster, or there is nothing to choose from.
 */
async function handleChooseRep(req, res, decoded) {
  try {
    const scope = await loadAdviserScope(decoded.uid);
    if (scope.error) return res.status(scope.error.status).json(scope.error.body);

    const { matric, clear } = req.body || {};
    const rosterRef = db.collection("departmentRosters").doc(
      rosterDocId(scope.institution, scope.department, scope.level),
    );

    // Re-read inside the transaction: a concurrent import could otherwise
    // change the roster between the membership check and the write.
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(rosterRef);
        if (!snap.exists) throw new Error("NO_ROSTER");
        const roster = snap.data();
        const matrics = Array.isArray(roster.matrics) ? roster.matrics : [];

        if (clear) {
          // Standing the rep down is a CHANGE like any other, so it is logged
          // the same way — otherwise "who was rep in March?" is unanswerable.
          tx.update(rosterRef, {
            chosenRepMatric: null,
            chosenRepUid: null,
            chosenRepName: null,
            chosenRepAt: null,
            repChanges: appendRepChange(roster.repChanges, {
              action: "cleared",
              previousMatric: roster.chosenRepMatric || null,
              previousName: roster.chosenRepName || null,
              matric: null,
              name: null,
              at: Timestamp.now(),
              by: decoded.uid,
            }),
          });
          return;
        }

        // Normalised exactly as the CSV parser stored it, so a lowercase
        // matric from the client still matches the stored list.
        const wanted = norm(matric);
        if (!wanted) throw new Error("NO_MATRIC");
        if (!matrics.includes(wanted)) throw new Error("NOT_ON_ROSTER");

        const student = (Array.isArray(roster.students) ? roster.students : []).find((s) => s.matric === wanted);
        const repName = (student && student.name) || roster.chosenRepName || null;
        // Replacing a rep is allowed but LOGGED, with the outgoing rep named.
        // The old rep is not edited here: they keep their account and simply
        // stop being the rep, which is what "becomes a regular student" means.
        // Their role is demoted by the same transaction via `role: "student"`
        // in Phase 5 when the account is linked, not here.
        const isReplacement = Boolean(roster.chosenRepMatric) && roster.chosenRepMatric !== wanted;
        // 🔒 The outgoing rep may already have an account. "Old rep becomes a
        // regular student" is only true if their profile actually says so, so
        // the demotion happens here rather than being assumed. A null
        // `chosenRepUid` means they never signed up, so there is nothing to do.
        if (isReplacement && roster.chosenRepUid) {
          tx.update(db.collection("users").doc(roster.chosenRepUid), {
            role: ROLE.STUDENT,
            isRep: false,
            repGrantedByAdviser: false,
          });
        }
        tx.update(rosterRef, {
          chosenRepMatric: wanted,
          chosenRepName: repName,
          // Stays null until that student signs up; Phase 5 links the account.
          chosenRepUid: null,
          chosenRepAt: FieldValue.serverTimestamp(),
          repChanges: appendRepChange(roster.repChanges, {
            action: isReplacement ? "replaced" : roster.chosenRepMatric ? "unchanged" : "chosen",
            previousMatric: isReplacement ? roster.chosenRepMatric : null,
            previousName: isReplacement ? roster.chosenRepName || null : null,
            matric: wanted,
            name: repName,
            at: Timestamp.now(),
            by: decoded.uid,
          }),
        });
      });
    } catch (txErr) {
      if (txErr.message === "NO_ROSTER") {
        return res.status(404).json({ error: "Import your level roster before choosing a rep.", code: "NO_ROSTER" });
      }
      if (txErr.message === "NO_MATRIC") {
        return res.status(400).json({ error: "Choose a student from the roster.", code: "NO_MATRIC" });
      }
      if (txErr.message === "NOT_ON_ROSTER") {
        return res.status(400).json({
          error: "That matric is not on this level's roster. Import the roster first, or pick a student from the list.",
          code: "NOT_ON_ROSTER",
        });
      }
      throw txErr;
    }

    const after = (await rosterRef.get()).data() || {};
    return res.status(200).json({
      success: true,
      chosenRepMatric: after.chosenRepMatric || null,
      chosenRepName: after.chosenRepName || null,
      cleared: Boolean(clear),
    });
  } catch (error) {
    console.error("roster chooseRep error:", error);
    return res.status(500).json({ error: "Unable to update the course rep." });
  }
}

/** The adviser's read-only dashboard view. Counts and the rep, never the whole list. */
async function handleGetRoster(req, res, decoded) {
  try {
    const scope = await loadAdviserScope(decoded.uid);
    if (scope.error) return res.status(scope.error.status).json(scope.error.body);

    const rosterRef = db.collection("departmentRosters").doc(
      rosterDocId(scope.institution, scope.department, scope.level),
    );
    const snap = await rosterRef.get();
    if (!snap.exists) {
      return res.status(200).json({
        exists: false,
        institution: scope.institution,
        department: scope.department,
        level: scope.level,
        count: 0,
        students: [],
        chosenRepMatric: null,
      });
    }

    const roster = snap.data();
    const students = Array.isArray(roster.students) ? roster.students : [];
    const matrics = Array.isArray(roster.matrics) ? roster.matrics : [];
    // 🔎 DIAGNOSTIC. The dashboard showed 0 students and an unknown import date
    // after a reported success. The write and the read are provably the same
    // document id, so the only way to settle it is to report what is ACTUALLY
    // stored. These are counts and the doc id, not user data, and they make the
    // next failure self-describing instead of another guessing round.
    console.log("roster get:", JSON.stringify({
      id: rosterRef.id,
      countField: typeof roster.count,
      count: roster.count,
      studentsLen: students.length,
      matricsLen: matrics.length,
      hasImportedAt: Boolean(roster.importedAt),
      repChangesLen: Array.isArray(roster.repChanges) ? roster.repChanges.length : 0,
    }));
    return res.status(200).json({
      exists: true,
      // The id actually read, so a mismatch is visible instead of inferred.
      rosterId: rosterRef.id,
      institution: roster.institution,
      department: roster.department,
      level: roster.level,
      count: roster.count || students.length,
      // Capped so a malformed import cannot return an unbounded list.
      students: students.slice(0, PREVIEW_LIMIT),
      truncated: students.length > PREVIEW_LIMIT,
      chosenRepMatric: roster.chosenRepMatric || null,
      chosenRepName: roster.chosenRepName || null,
      chosenRepUid: roster.chosenRepUid || null,
      // The rep-change trail, newest last. Bounded by REP_CHANGE_LIMIT on write.
      repChanges: Array.isArray(roster.repChanges) ? roster.repChanges.slice(-20) : [],
      lastImportAt: roster.importedAt || null,
    });
  } catch (error) {
    console.error("roster get error:", error);
    return res.status(500).json({ error: "Unable to load the roster." });
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
      case "importRoster": return handleImportRoster(req, res, decoded);
      case "chooseRep": return handleChooseRep(req, res, decoded);
      case "getRoster": return handleGetRoster(req, res, decoded);
      default:
        return res.status(400).json({ error: "Invalid action. Use: importRoster, chooseRep, getRoster" });
    }
  } catch (error) {
    console.error("Roster API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
