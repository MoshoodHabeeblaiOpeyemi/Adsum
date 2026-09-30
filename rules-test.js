// Adsum — Firestore rules smoke test
//
// WHY THIS EXISTS
// ---------------
// `firestore.rules` is the only thing standing between a signed-in account and
// every other user's data, and it is the one file in this repo that
// `npm run check` cannot validate: check.js parses JavaScript, not the rules
// language. Meanwhile .github/workflows/deploy-firestore-rules.yml ships
// firestore.rules straight to the live Firebase project on every push to main.
// Rules are therefore the easiest thing here to break silently, and the only
// thing where "it deployed" and "it works" can differ without anyone noticing.
//
// That is not hypothetical. The first run of this file found a real hole: the
// proof-of-presence guard on session hotspots existed only on the `update`
// rule. A rep could skip grantHotspot and `setDoc` a brand-new member row with
// `role: "session_assistant"` for a student who never scanned in -- and because
// `session_assistant` counts as course STAFF in `isCourseStaff()`, that row
// also handed its owner read access to `session/secret`, the live rotating PIN.
// Creating is now guarded exactly as updating is. Keep this file running.
//
// HOW TO RUN
// ----------
// 1. Start the Firestore emulator with the rules under test. The emulator jar
//    is cached by the Firebase CLI (installing firebase-tools downloads it):
//
//      java -jar "$HOME/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar" \
//           --rules firestore.rules --port 8080
//
//    On Windows the cache is %USERPROFILE%\.cache\firebase\emulators\.
//
// 2. node rules-test.js          (Node 18+; uses the global fetch)
//
// Override the target with EMULATOR_HOST (default 127.0.0.1:8080) and the
// project with FIREBASE_PROJECT_ID (default attendify-4c93d, the live project,
// so the rules see the project id they run under in production).
//
// HOW IT WORKS
// ------------
// Documents are seeded as `Bearer owner` -- the emulator's admin bypass, which
// skips rules entirely, the same privilege the Admin SDK holds in production --
// so every assertion starts from a known state. Everything under test is then
// issued with an unsigned JWT whose `sub` becomes request.auth.uid, which is
// what makes the emulator evaluate the real rules against a real identity.
// A test that expects 403 and gets 200 is a hole; one that expects 200 and gets
// 403 is an app-breaking regression. Both fail the run.

const HOST = process.env.EMULATOR_HOST || "127.0.0.1:8080";
const PID = process.env.FIREBASE_PROJECT_ID || "attendify-4c93d";
const DOCS = `http://${HOST}/v1/projects/${PID}/databases/(default)/documents`;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${actual}, want ${expected})`);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
// The emulator decodes the token without verifying the signature; uid comes from sub/user_id.
const tokenFor = (uid) =>
  `${b64({ alg: "none", typ: "JWT" })}.${b64({
    sub: uid, user_id: uid, aud: PID,
    iss: "https://securetoken.google.com/" + PID,
    iat: 1700000000, exp: 2000000000,
  })}.`;

async function req(method, path, { body, uid } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (uid === "admin") headers.Authorization = "Bearer owner";
  else if (uid) headers.Authorization = `Bearer ${tokenFor(uid)}`;
  const res = await fetch(`${DOCS}${path}`, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.status;
}

const S = (v) => ({ stringValue: v });
const B = (v) => ({ booleanValue: v });
const A = (...vals) => ({ arrayValue: { values: vals } });
const N = () => ({ nullValue: null });

const userDoc = (uid, matric, extra = {}) => ({
  uid: S(uid), matric: S(matric), name: S("Test " + uid),
  institution: S("UNILAG"), department: S("Geology"), level: S("200L"),
  isRep: B(false), ...extra,
});

const courseDoc = (repUid, matric, over = {}) => ({
  name: S("GEOL 201"), code: S("GEOL201"), rep: S("Test " + repUid),
  repUid: S(repUid), institution: S("UNILAG"), department: S("Geology"),
  level: S("200L"), enrolled: A(S(matric)), assistants: A(),
  attendanceHistory: A(), activeSession: N(), ...over,
});

const create = (path, uid, fields) =>
  req("PATCH", `${path}?currentDocument.exists=false`, { uid, body: { fields } });

async function main() {
  // ---- seed as admin (the Admin SDK's rule-bypassing privilege) ----
  await create("/users/student1", "admin", userDoc("student1", "24/56SV001"));
  await create("/users/rep1", "admin", userDoc("rep1", "24/56SV002", {
    role: S("rep"), repGrantedByAdviser: B(true), isRep: B(true),
  }));

  // ---- course catalog: creation is the most dangerous write in the app ----
  check("A. anonymous cannot list courses", await req("GET", "/courses"), 403);

  check("B. granted rep creates a valid course",
    await create("/courses/courseA", "rep1", courseDoc("rep1", "24/56SV002")), 200);

  check("C. course level must match the rep's profile",
    await create("/courses/courseC", "rep1", courseDoc("rep1", "24/56SV002", { level: S("300L") })), 403);

  check("D. student cannot self-appoint as course rep",
    await create("/courses/courseD", "student1", courseDoc("student1", "24/56SV001")), 403);

  check("E. create cannot pre-stuff enrolled[]",
    await create("/courses/courseE", "rep1", courseDoc("rep1", "24/56SV002", {
      enrolled: A(S("24/56SV002"), S("24/56SV999")),
    })), 403);

  check("F. create rejects unexpected fields",
    await create("/courses/courseF", "rep1", courseDoc("rep1", "24/56SV002", { verified: B(true) })), 403);

  check("G. course repUid is immutable",
    await req("PATCH", "/courses/courseA", { uid: "rep1", body: { fields: { repUid: S("student1") } } }), 403);

  check("H. non-staff cannot update the course",
    await req("PATCH", "/courses/courseA", { uid: "student1", body: { fields: { name: S("hacked") } } }), 403);

  // ---- the session documents: the PIN, the rotation clock, the attendee list ----
  check("I. session/live is backend-only",
    await create("/courses/courseA/session/live", "rep1", { pin: S("1234") }), 403);

  check("J. session/secret is backend-only",
    await create("/courses/courseA/session/secret", "rep1", { pin: S("1234") }), 403);

  check("K. manual request creation is backend-only",
    await create("/courses/courseA/manualRequests/student1", "student1", {
      uid: S("student1"), status: S("pending"), reason: S("please"),
    }), 403);

  check("L. pinAttempts unreadable by the client",
    await req("GET", "/pinAttempts/student1_courseA", { uid: "student1" }), 403);

  check("M. matricRegistry unreadable by the client",
    await req("GET", "/matricRegistry/UNILAG%7C24%2F56SV001", { uid: "student1" }), 403);

  // ---- users: identity fields and the role vocabulary are server-owned ----
  check("N. user reads their own profile",
    await req("GET", "/users/student1", { uid: "student1" }), 200);

  check("O. user cannot read another profile",
    await req("GET", "/users/rep1", { uid: "student1" }), 403);

  check("P. client cannot self-promote to level_anchor",
    await req("PATCH", "/users/student1", {
      uid: "student1",
      body: { fields: { ...userDoc("student1", "24/56SV001"), role: S("level_anchor"), verificationStatus: S("verified") } },
    }), 403);

  // ---- session hotspots: proof-of-presence, on BOTH verbs ----
  // A hotspot holder can read the PIN and show it to the room, so granting one
  // must prove the student was actually in the hall. The guard used to exist
  // only on `update`; the first three checks below are what caught that.
  check("Q. create: hotspot needs a live session",
    await create("/courses/courseA/members/student1", "rep1", {
      uid: S("student1"), matric: S("24/56SV001"), role: S("session_assistant"),
    }), 403);

  // A live session in which student2 (24/56SV003) scanned in; student1 did not.
  await create("/courses/courseA/session/live", "admin", {
    expiresAt: { integerValue: "9999999999999" }, pin: S("1234"),
  });
  await create("/courses/courseA/session/secret", "admin", {
    pin: S("1234"), attendees: A(S("24/56SV003")),
  });

  check("R. create: hotspot needs the student to have scanned in",
    await create("/courses/courseA/members/student1", "rep1", {
      uid: S("student1"), matric: S("24/56SV001"), role: S("session_assistant"),
    }), 403);

  check("S. create: hotspot allowed for a student who did scan in",
    await create("/courses/courseA/members/student2", "rep1", {
      uid: S("student2"), matric: S("24/56SV003"), role: S("session_assistant"),
    }), 200);

  check("T. rep can still enrol a plain member",
    await create("/courses/courseA/members/student1", "rep1", {
      uid: S("student1"), matric: S("24/56SV001"), role: S("student"),
    }), 200);

  check("U. update: hotspot needs the student to have scanned in",
    await req("PATCH", "/courses/courseA/members/student1", { uid: "rep1", body: { fields: {
      uid: S("student1"), matric: S("24/56SV001"), role: S("session_assistant"),
    } } }), 403);

  check("V. update: member matric cannot be swapped to a scanned-in classmate",
    await req("PATCH", "/courses/courseA/members/student1", { uid: "rep1", body: { fields: {
      uid: S("student1"), matric: S("24/56SV003"), role: S("session_assistant"),
    } } }), 403);

  // ---- what a hotspot does and does not unlock ----
  check("W. hotspot can read session/secret (by design)",
    await req("GET", "/courses/courseA/session/secret", { uid: "student2" }), 200);

  check("X. plain member cannot read the PIN secret",
    await req("GET", "/courses/courseA/session/secret", { uid: "student1" }), 403);

  check("Y. member can read session/live",
    await req("GET", "/courses/courseA/session/live", { uid: "student1" }), 200);

  // ---- recorded gaps, asserted so a future fix is a deliberate act ----
  // These two encode CURRENT behaviour, not desired behaviour. When the
  // catalog/roster split lands, Z must flip to 403 and this comment goes with
  // it; until then the gap is documented in docs/SECURITY_MODEL.md#known-gaps
  // rather than merely absent.
  check("Z. [KNOWN GAP] any signed-in user can read a course doc",
    await req("GET", "/courses/courseA", { uid: "student1" }), 200);

  check("AA. unknown collection is denied by default",
    await req("GET", "/somethingElse/x", { uid: "student1" }), 403);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("TEST HARNESS ERROR:", e.message);
  console.error("Is the Firestore emulator running with --rules firestore.rules?");
  process.exit(2);
});
