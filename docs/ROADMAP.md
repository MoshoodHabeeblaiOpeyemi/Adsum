# Roadmap

## Working rules

1. **One phase at a time.** No parallelism. Do not start Phase N+1 until Phase N is
   committed, tested and clean.
2. **Commit per sub-task**, small and descriptive.
3. **`node --check` every modified `api/*.js`** before committing.

   > ⚠️ **Never use `node --check` on `app.js`.** It is an ES module, so
   > `node --check` parses it as CommonJS, throws on the first `import` and
   > stops — **reporting success on a file that does not parse.** A stray comma
   > in a ternary shipped through several rounds of review because of exactly
   > this. Use `npm run check` (or `node --experimental-vm-modules check.js`)
   > instead, which parses browser files as modules and checks every top-level
   > function individually. Note `npm` may be blocked by the PowerShell execution
   > policy on some machines; invoking `node` directly always works.
4. **Never** change a Firestore collection name or the Firebase project ID.
5. Every new endpoint verifies the ID token first, reads before writes in a transaction,
   and logs failures without exposing internals.
6. Every new UI element runs user data through `escapeHTML()` before it enters the DOM.
7. After each phase: update the docs, commit, push, confirm the deployed preview works.

Phase 1's real deliverable is [SECURITY_MODEL.md](SECURITY_MODEL.md) — the frozen contract
that stops later phases from regressing what four audit rounds established.

---

## Done

| Phase | What | Status |
| --- | --- | --- |
| **1** | Documentation — README, `.env.example`, `PRESENTATION.md`, `ARCHITECTURE.md`, `SECURITY_MODEL.md`, `ROADMAP.md` | ✅ |
| **2** | Brand asset pipeline — offline C# toolchain, SOLID + CUTOUT variants, icon set, preview sheet | ✅ |
| **3** | Rebrand — 70 occurrences across 7 files, case-sensitive sweep, localStorage migration | ✅ |

---

## Phase 4 — Canonical identity · 1–1.5 days

**The gate.** Phases 6 and 7 cannot work without it.

Today `institution`, `department` and `level` are free text compared with `norm()`
(`api/course.js:69-74`). "UNILORIN", "Unilorin" and "University of Ilorin" are three
different institutions as far as the code is concerned — so a roster keyed on any of them
is unreliable.

| Deliverable | Detail |
| --- | --- |
| `institutions/{id}` | `{name, code, aliases[], emailDomains[]}`. This **replaces** a separate `universityDomains` collection — one document, not two |
| `departments/{id}` | `{name, slug, institutionId, faculty}` |
| Level enum | Fixed set; must match `departmentRosters` key segments |
| Signup resolver | Replaces the autocomplete *hint* with a resolver that **refuses** non-canonical values |
| Backward compatibility | Store `institutionId` / `departmentId` / `levelCode` **alongside** the display strings — never instead of them |
| Backfill | Idempotent script, dry-run first |
| Rules | Readable by `signedIn`; writable by the backend only |

Seed UNILORIN, UI and OAU.

**Risk if skipped:** every later phase keys on strings that do not agree, and the fix
becomes a migration of live user data instead of a seed script.

`feat(identity): canonical institutions/departments + signup resolver`

---

## Phase 5 — Tier 1 security · ✅ shipped

Retires every gap in [SECURITY_MODEL.md](SECURITY_MODEL.md#known-gaps) that the PIN could be brute-forced or frozen against.

| Item | Detail |
| --- | --- |
| PIN submission throttle | `utils/throttle.js`. 5 failures per `{uid}_{courseId}` per 30s sliding window, counted **inside a transaction** — a read-then-write limiter has a race, and 50 parallel requests would all read `count: 0`. Keyed on uid, not IP, so a student switching Wi-Fi→mobile is unaffected. Cleared on success so honest typos don't accumulate |
| 🔒 Server PIN rotation | `api/session?action=rotatePin`. PIN generated with `crypto.randomInt`, `pinRotationTime` written with `serverTimestamp()`. The client can no longer backdate the timestamp or predict the next PIN |
| 🔒 Server session start | `?action=startSession` mints the **first** PIN too. It had to be a separate endpoint: `rotatePin` requires a live session, so on the opening click it 403s — which left the first PIN (on screen for the first 10 seconds of every class, and the one a relay attacker most wants) still generated in the rep's browser with `Math.random()` and a client clock. There is now **no local fallback**: if the call fails the rep sees an error rather than unknowingly running an unrotatable class |
| 🔒 Session docs backend-only | `session/live` and `session/secret` had `allow write` for the rep. A rep who can write those sets both a PIN *and* a rotation time of their choosing — the same hole, one layer down. Both are now `allow write: if false`; reads are unchanged |
| 🔒 The read-back trap | `FieldValue.serverTimestamp()` is a **sentinel**, not a value. `Date.now() - secret.pinRotationTime` yields **NaN**, and every freshness comparison then silently fails **open**. All reads go through `ageMs()` in `utils/geo.js`, which handles Timestamp / legacy number / raw gRPC / Date / ISO, and treats an absent or corrupt value as **expired**, never fresh |
| ⚠️ Skew grace | 2s added to both windows, for a rep's device clock disagreeing with the server's |
| ⚠️ Preserve the windows | `× 2` (current) and `× 3` (previous) kept distinct, exactly as `SECURITY_MODEL.md` requires |
| Server geofence | `haversineMetres()` in `utils/geo.js`. The client gate is now a convenience; the server compares the submitted coordinates to the hall, rejects `accuracy > 500m` (which would otherwise be a way around the radius), and skips only when `locationMode === "no_gps"` |
| `departmentReps` | Was **client-writable** — `setDoc` with `repUid == auth.uid` was self-appointment, defeating Phase 5's whole point. Now `allow write: if false` |
| `pinAttempts` | New collection, backend-only. The client can neither read its own count nor clear it |
| Constant-time PIN compare | `diff \|= x ^ y` over the whole string, so a wrong PIN cannot be probed digit-by-digit by timing |
| Generic 500s | **11** responses were returning `error.message`, which routinely embeds Firestore collection and document paths. All now log in full server-side and return a fixed sentence |

`security: server-authoritative PIN rotation, throttle, geofence, generic errors`

---

## Phase 6 — Level Anchor + composite verification · 3–5 days

The feature that makes an institution trust VeriPresenX.

**An anchor is tied to a LEVEL, not a whole department.** Geology has 100L, 200L, 300L,
400L, 500L; each level has its own anchor, because that is how Nigerian universities
delegate — each cohort has a Level Adviser. Dr. Adeyemi anchors 200L and does not manage
100L or 400L.

```text
Level Anchor (verified staff, for one level of one department)
      ↓
    Rep (student, verified by matric + the existence of an anchor for their level)
      ↓
Student (verified by matric + the existence of a rep for their course)
```

Verified by **identity evidence**, not by a human vouching for a human:

| Path | Mechanism |
| --- | --- |
| A — University email | `institutions/{id}.emailDomains` → send a code to that address |
| B — NIN | Licensed provider returns name, DOB, photo; compare photo to the live selfie |
| C — Staff ID | Upload + directory cross-check, else operator review |

`role: "level_anchor"` · `adviserVerifications/{uid}` (transient 6-digit code) ·
`adviserSlots/adviser_{INST}_{DEPT}_{LEVEL}` (one-adviser-per-level claim) ·
`api/verification.js` (7th function; the Hobby cap is 12, so it fits).

`api/onboarding.js` (8th function) completes the loop: the profile write moves
off the client, so `role` / `isAdviser` / `verificationStatus` are server-owned
from the very first write rather than merely pinned on update. The endpoint is
`POST /api/onboarding?action=createProfile`; it claims the rep slot in the SAME
transaction as the profile (closing the check-then-act race the client had) and,
for advisers, mints and mails the first 6-digit code so signup is the only step
the user has to complete.

---

## Phase 4 — Adviser roster · ✅ shipped (backend + UI)

The trust chain's gate. An adviser imports the level master list and names ONE
rep from it, which is what turns the rep badge from *claimed* into *granted*.

`api/roster.js` (9th function) · `utils/csv.js` · `departmentRosters/{INST}_{DEPT}_{LEVEL}`

| Action | Behaviour |
| --- | --- |
| `importRoster` | Parses the CSV and reports counts **without writing**; a confirmed `commit: true` stores it. All-or-nothing — a partial import would hide missing students until someone fails to check in |
| `chooseRep` | The matric must already be on the roster. Runs in a transaction so a concurrent import cannot change the list underneath the check. `clear: true` stands the rep down |
| `getRoster` | Read-only view: counts, the rep, last import. Capped at 200 entries |
| `endAcademicSession` | Clears the imported level roster for the next academic session; the selected rep and course attendance history are preserved |

Three decisions worth keeping:

- **Scope comes from the profile, never the body.** There is no
  `institutionId`/`departmentId`/`levelCode` parameter to tamper with, so one
  adviser cannot read or write another's roster.
- **Gated on `isVerifiedAdviser()`**, not `role === "adviser"` — the latter is
  the value every unverified applicant holds.
- **Read-only to clients.** `firestore.rules` gives `departmentRosters` no write
  path at all; the only writer is the Admin SDK.

A re-import that no longer contains the current rep **drops the selection** and
reports `repDropped`, because a rep who is not on the level roster is exactly
the state this feature exists to prevent.

**CSV format.** We do not get to specify it — the adviser exports whatever
their department uses. `utils/csv.js` therefore matches a generous set of
headings (`Matric`, `Matric No`, `S/No`, `S/N`, `Reg No`, `Student No`,
`Index No`…), joins **Surname + Other Names** into one name, and when the
headings are unhelpful it **detects the column from the shape of its values**
(`24/56SV002` and variants) — warning the adviser when it does so. It survives a
missing header row and a title banner above it. Only a broken identity is an
error; everything else is a warning.

**Rep changes are logged.** Every choose, replace, clear and re-import appends to
`repChanges[]` with the outgoing rep named (bounded at 50 entries). Replacing asks
for explicit confirmation and states plainly that the old rep becomes a regular
student; the same is true of clearing. A re-import never erases the history.

**Next:** Phase 6 makes student signup consult `matrics[]` for roster validation.

---

## Phase 5 — Rep is granted, not claimed · ✅ shipped

The rep badge used to be won by arriving first: the client raced two signups for
an empty `departmentReps` slot. It is now a decision the adviser makes and the
server records.

`utils/rosters.js` · `api/onboarding.js` · `api/roster.js` · `app.js`

| Requested | Server finds | Result |
| --- | --- | --- |
| `rep` | matric === `chosenRepMatric` | `role: "rep"`, roster linked to the account |
| `rep` | roster exists, no rep chosen | `role: "student"` + `NO_REP_CHOSEN` |
| `rep` | roster exists, someone else chosen | `role: "student"` + `NOT_THE_CHOSEN_REP` |
| `rep` | no roster for this level | `role: "student"` + `NO_ROSTER` |

A refusal is **not** an error — the account is created, and the toast says
exactly which of the four happened, so "why am I not the rep?" is never a
mystery.

- The roster is found from the **profile's own** institution/department/level,
  never from a request parameter, so a student cannot point at a level where
  someone else is the rep.
- The client no longer writes its own profile; it posts to
  `/api/onboarding?action=createProfile` and deletes the Auth account if the
  profile write fails, so a ghost account cannot be left behind.
- **Replacing a rep demotes them for real** — the outgoing rep's profile is
  updated to `role: "student"`, `isRep: false` inside the same transaction.
  "The old rep becomes a regular student" is now true rather than assumed.
- **Naming a rep promotes them for real.** `chooseRep` finds the account by
  matric and writes `role: "rep"` + `repGrantedByAdviser: true` in the same
  transaction, then links `chosenRepUid`. Before this, the ONLY place a rep was
  ever granted was at signup, and only if the student had ticked the "Course Rep"
  card. Since the normal order is *students register, then the adviser picks*,
  naming an already-registered student left the dashboard showing a rep whose
  profile still said `student` — and `firestore.rules` gates course creation on
  `isAdviserGrantedRep()`, so that student could not create a course at all.
  The lookup is a one-field `matric` equality, which uses the automatic
  single-field index; a multi-field query would have needed an index to finish
  building first, which is the wrong moment to be fragile.
- `utils/rosters.js` owns the roster id so the writer and the reader cannot
  derive different documents. Its `normSegment()` collapses `"200L"`, `"200 L"`
  and `"200-L"` to one level — without it, an adviser who typed `200 L` and a
  student who typed `200L` would address different rosters and the rep check
  would silently find nothing.

`REP_SLOT_TAKEN` no longer exists in `app.js`.

---

## Phase 6 — Student roster validation · ✅ shipped

The last soft edge in the trust chain. Before this, **any** student could sign
up for any level; the roster recorded who belonged there but nothing consulted
it.

`api/onboarding.js` · `firestore.rules` · `app.js`

| Matric on `matrics[]` | `rosterStatus` | `rosterReason` |
| --- | --- | --- |
| yes | `verified` | `ON_ROSTER` |
| no, roster exists | `unverified` | `NOT_ON_ROSTER` |
| no roster imported | `unverified` | `NO_ROSTER` |
| adviser (no matric) | `null` | `null` |

**Deliberately a check, not a rejection.** Cross-level and service courses (GST)
legitimately produce students who are not on their programme's roster. Blocking
them at signup would strand them with no way forward, so they get an account and
a status that resolves when the adviser re-imports or the rep approves them. The
sign-up toast names the next step rather than leaving "why isn't my attendance
counting?" unanswered.

Details worth keeping:

- The roster is read **once** and both the rep grant and the membership check
  read that same object, so the two can never disagree about which document was
  consulted.
- Both decisions come from the **profile's own** institution/department/level,
  never a request parameter.
- `rosterStatus`, `rosterReason` and `repGrantedByAdviser` are **server-owned**:
  `create` forbids a client from asserting `verified` or `true`, and `update`
  pins all three. Without that, a student could set `rosterStatus: "verified"`
  from the console and skip the check entirely.

**Next: Phase 7 — pilot dry run** with one real department and 20–40 students.

### Do these first, before any code

1. **Privacy + retention doc.** NIN data and a selfie are the most sensitive material this
   app will ever hold. None of that policy exists today.
2. **`storage.rules` + the `firebase.json` storage block.** Upload client → Storage
   directly; do **not** base64 images into Firestore. Vercel's `/api` body limit is around
   4.5 MB.
3. **Decide where liveness runs.** Blink detection client-side; face-match server-side —
   shipping multi-MB face-api.js weights to students paying for data is the wrong call.

### Launch fallback: operator review, not peer-chain

A peer-review chain with no authenticated reviewer identity is a privilege-minting
surface: two colluding anchors could mint anchors indefinitely. Ship **operator manual
review** as the Phase 6 fallback and treat peer review as a later, carefully-designed
addition.

### Rep and student gates

- **Rep** — "Your level (Geology 200L) doesn't have a Level Anchor yet. Please ask your
  Level Adviser or HOD to sign up first."
- **Student** — "This course doesn't have a Course Rep yet. Please ask your Rep to sign up
  first."

Every block names the next concrete step. No dead ends.

---

## Phase 7 — Hybrid enrollment · 3–5 days

**One import per level per semester**, not per course.

Per-course lists are unrealistic: every lecturer would export from their own records.
Every university already has a master list per level per department, and getting it from
the department is trivial.

```text
ANCHOR (once per semester):  import the level's master list as CSV
                             → departmentRosters/{instId|deptId|levelCode|semester}
REP    (once per course):    link the course to that level roster
STUDENT:                     enter the code → matric found in the linked roster?
                               YES → auto-enrolled
                               NO  → rep approval queue
```

The queue covers cross-level and cross-department electives and service courses (GST
being the common case), so 100% of enrollment scenarios are handled without imposing a
workflow on any institution.

Keyed on **canonical IDs**, which is only possible after Phase 4 — this is why Phase 4 is
a gate rather than an optimization.

**⚠️ This deliberately relaxes the hard 403 at `api/course.js:69-74`.** See
[ARCHITECTURE.md](ARCHITECTURE.md#groundwork-for-phases-47).

---

## Phase 8 — Hardware API · 2–3 days

So no institution has an excuse. Same validation path as a phone check-in — same PIN
freshness, same device lock, same atomic transaction. Different input source only.

`POST /api/attendance?action=hardwareCheckin` · `hardwareDevices/{deviceId}` ·
`HARDWARE_INTEGRATION.md`

| Hardware | Integration |
| --- | --- |
| ZKTeco biometric | Local middleware pushes punch logs to the API |
| RFID readers | ESP32/Arduino firmware POSTs card UIDs |
| NFC tap | Browser Web NFC — no extra hardware |
| WebAuthn | Browser-native — no extra hardware |

---

## Phase 9 — WebAuthn + Web NFC · 2–3 days

`users/{uid}/webauthnCredentials`; optional per-course `course.requireBiometric: true`.

These are the no-hardware alternatives, and for most institutions they are simply better:
nothing to buy, install, maintain or replace.

| What hardware schools have | VeriPresenX's alternative |
| --- | --- |
| Fingerprint scanner | WebAuthn — the student's own phone biometric |
| RFID card tap | Web NFC — phone taps a tag at the door |
| Face camera | Live selfie with liveness during check-in (optional) |
| Door counter | Rep headcount vs system count |

---

## Phase 10 — Capacitor shell · 1–2 weeks

**Do not start until Phases 4–9 are shipped and stable.**

The driver: browser GPS is unreliable indoors, and research supports that native location
APIs are materially better because they fuse GPS with Wi-Fi and cell data.

Wrap the existing codebase in Capacitor — **no rewrite**. Unlocks FusedLocation
(Android) / CoreLocation (iOS), native geofencing, better iOS push, NFC reading, and
hall-Wi-Fi BSSID fingerprinting.

---

## Open questions

Flag these as they come up; none block Phase 4.

1. **NIN provider** — VerifyMe, Dojah or YouID? Cost per verification?
2. **Face match** — in-house with face-api.js, or an external API?
3. **Liveness** — blink only, or blink + head-turn?
4. **Peer review** — how is a "previously verified anchor" authenticated to review others?
   (See the Phase 6 fallback above.)
5. **Cross-institution courses** — do any Nigerian universities share courses across
   institutions? If yes, that needs a special case in Phase 7.
6. **Offline check-in** — confirm this stays online-first. The server clock is the
   anti-cheat authority, so an offline queue would need a completely different trust model.
