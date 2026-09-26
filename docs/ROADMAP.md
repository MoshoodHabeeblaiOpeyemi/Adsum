*/=]\# Roadmap

## Working rules

1. **One phase at a time.** No parallelism. Do not start Phase N+1 until Phase N is
   committed, tested and clean.
2. **Commit per sub-task**, small and descriptive.
3. **`node --check` every modified `api/*.js`** before committing.
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

## Phase 5 — Tier 1 security · 1 day

Retires the known gaps in [SECURITY_MODEL.md](SECURITY_MODEL.md#known-gaps).

| Item | Detail |
| --- | --- |
| Server-side PIN rotation | New `rotatePin` action. Server writes `pinRotationTime` with `serverTimestamp()` |
| ⚠️ Skew grace | `serverTimestamp()` is a sentinel, not a number. Read it back with `.toMillis()`, and allow a small clock-skew window — see [SECURITY_MODEL.md](SECURITY_MODEL.md#phase-5-must-not-break-this) |
| ⚠️ Preserve the windows | Keep `× 2` (current) and `× 3` (previous). Do not collapse them to one interval |
| Server-counted strikes | Move `MANUAL_OVERRIDE_STRIKES_REQUIRED` off the client; the counter must not be clearable from devtools |
| App Check hard mode | Only **after** `APP_CHECK_SITE_KEY` is set and verified traffic is confirmed |

`security: server-authoritative PIN rotation, strikes, App Check hard mode`

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

## Phase 4 — Adviser roster · ✅ backend shipped

The trust chain's gate. An adviser imports the level master list and names ONE
rep from it, which is what turns the rep badge from *claimed* into *granted*.

`api/roster.js` (9th function) · `utils/csv.js` · `departmentRosters/{INST}_{DEPT}_{LEVEL}`

| Action | Behaviour |
| --- | --- |
| `importRoster` | Parses the CSV and reports counts **without writing**; a confirmed `commit: true` stores it. All-or-nothing — a partial import would hide missing students until someone fails to check in |
| `chooseRep` | The matric must already be on the roster. Runs in a transaction so a concurrent import cannot change the list underneath the check. `clear: true` stands the rep down |
| `getRoster` | Read-only view: counts, the rep, last import. Capped at 200 entries |

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

**Still outstanding:** the adviser dashboard UI. Phase 5 then makes signup
consult `chosenRepMatric` and deletes the client-side `REP_SLOT_TAKEN` race.

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
