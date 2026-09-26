# Architecture

## Runtime shape

```text
Browser (PWA)                    Vercel serverless              Firestore
──────────────                   ─────────────────              ─────────
index.html + app.js   ──POST──►  api/{account,approval,  ──►    rules are the
  Firebase Auth ID token         attendance,course,             access boundary
  x-firebase-appcheck            semester,session}.js
                                 Firebase Admin SDK
                                 (bypasses rules)
  ◄──── onSnapshot ───────────────────────────────────────────  live listeners
```

The client holds **no** privileged writes. Everything that touches attendance, flags,
device state or the matric registry goes through a serverless function that first
verifies the ID token. The client's Firestore access is read-mostly, plus a handful of
narrow, rule-guarded writes (creating a course, editing your own pending manual request,
creating a security event attributed to yourself).

There is no build step. `app.js` is served as-is; `vercel.json` disables caching for
`/`, `index.html`, `app.js`, `style.css` and `sw.js` so a deploy is never shadowed by a
cached service worker.

---

## Collections

### Top level

| Collection | Doc ID | Written by | Purpose |
| --- | --- | --- | --- |
| `users` | `{uid}` | **backend only** (`api/onboarding.js`) | Profile: `uid`, `matric`, `isRep`, `institution`, `department`, `level`, plus `role` / `isAdviser` / `verificationStatus` / `verifiedAt` / `verificationMethod`, which only the backend may ever change |
| `users/{uid}/fcmTokens` | push token | client (self) | Device registrations for emergency alerts |
| `users/{uid}/notifications` | auto | **backend only** | "Flagged absent — see your Rep" alerts. Client may read, never write |
| `courses` | `{courseId}` | client (create, `validCourseFields()`) | `code`, `repUid`, `institution`, `department`, `level`, `enrolled[]`, `assistants[]` |
| `departmentReps` | `{repId}` | client (self) | Rep directory for cross-course discovery |
| `matricRegistry` | `INST\|MATRIC` | **backend only** | One matric → one uid. `allow read, write: if false` |
| `devices` | `u_{uid}` | **backend only** | `{uid, matric, lastSeenAt}` — the device lock |
| `adviserVerifications` | `{uid}` | **backend only** | Transient 6-digit adviser code + `attempts` (max 5) + `expiresAt` (10 min). Deleted on success or lockout |
| `adviserSlots` | `adviser_{INST}_{DEPT}_{LEVEL}` | **backend only** | The one-adviser-per-level claim. Written in the same transaction that promotes the user to `role: "level_anchor"` |
| `departmentRosters` | `{INST}_{DEPT}_{LEVEL}` | **backend only** (`api/roster.js`) | The adviser's imported level list: `{institution, department, level, adviserUid, students[], matrics[], count, chosenRepMatric, chosenRepName, chosenRepUid, importedAt}`. Clients may **read** it (only if `isVerifiedAdviser()`) and never write |

### `users/{uid}` role vocabulary

`utils/roles.js` is the single source of truth. The two adviser values mean
**different things** and are not interchangeable:

| Value | Meaning | Written by |
| --- | --- | --- |
| `role: "adviser"` + `verificationStatus: "pending_email"` | Applied, **unverified**. Adviser tools are locked. | `api/onboarding.js` |
| `role: "level_anchor"` + `verificationStatus: "verified"` | **Proven staff** — the root of the trust chain. | `api/verification.js` only |

Authorisation uses `isVerifiedAdviser(profile)`, which requires **both** halves
and so fails closed on any partial state. A gate written as
`role === "adviser"` is a privilege escalation: it admits every unverified
applicant.

The UI label ("Level Adviser") is deliberately a display string and is kept in
`ROLE_LABEL` (`app.js`), separate from the stored values, so the vocabulary can
be read in one place.

**Both rule halves are load-bearing.** `create` constrains a new profile to the
unprivileged end of the model (no client may assert `level_anchor`, `verified`,
`verifiedAt` or `verificationMethod`); `update` pins those fields so an existing
account cannot climb. Pinning only `update` leaves the document *creatable* in
an already-promoted state, which is a hole in its own right.

### `courses/{courseId}` subcollections

| Subcollection | Doc ID | Written by | Shape |
| --- | --- | --- | --- |
| `members` | `{uid}` | rep (client) or backend | `{uid, matric, role}` — `role` ∈ `student` \| `assistant` \| `session_assistant` \| `rep` |
| `session/live` | fixed `live` | course staff | `{pin, previousPin, pinRotationTime, expiresAt, pinRotationInterval, locationMode, qrMode}` — the public session doc |
| `session/secret` | fixed `secret` | **rep only** | `{pin, previousPin, pinRotationTime, attendees[], managerMatric, rejectedFixes[]}` — the answer key |
| `checkins` | `{uid}_{ts}` | **backend only** | `{uid, matric, checkedInAt, lat, lon, accuracy}` |
| `attendance` | `session_{ts}` | **backend only** | Closed-session summary: `{date, attendees[], attendeeGroups, systemCount, physicalHeadcount, flaggedAbsent[], autoMarked[], hotspots[]}` |
| `deviceFlags` | `{flagId}` | **backend only** | Multiple accounts on one physical device |
| `absentFlags` | `{uid}` | **backend only** | `{matric, status, flaggedBy, flaggedAt, reason, sessionExpiresAt}` — permanent |
| `manualRequests` | `{uid}` | client (self) / backend | The 3-strike escape hatch, resolved by staff |
| `hotspotLog` | `{escapedMatric}_{expiresAt}` | **backend only** | Public audit of hotspot grants |
| `removalLog` | auto | **backend only** | `{matric, removedBy, removedAt}` |
| `exemptions` | auto | rep (client) | `{matric, date}` — **public by design**, minus reasons |
| `exemptionReasons` | auto | course staff | Private reasons, staff-only |
| `securityEvents` | auto | client (self) | `{uid, type, sessionExpiresAt}` — `screenshot_attempt` \| `left_app` |
| `groups` | auto | course staff | `{name, members[], leadMatric}` — sub-classes inside one course |
| `notifications` | auto | **backend only** | Course-scoped alerts |

**Why `session/live` and `session/secret` are separate.** Members can *read* `live` (they
need the session state and rotation countdown) but only staff can read `secret`, which
holds the PIN answer key and the attendees array. Splitting them means the read
permission for the public session state does not also expose the answer key.

---

## Two subtle mechanics worth knowing

### `enrolled[]` vs `members/*`

The roster is stored **twice, deliberately**: `courses/{id}.enrolled` is a matric array
used for fast count rendering and `arrayRemove` on removal, while `members/{uid}` is the
authoritative per-student row carrying `role`. Both are updated inside the same
transaction (`api/course.js:44`, `api/account.js:44`, `api/account.js:157-158`) so they
cannot drift. When you touch enrollment, update both or you will get a roster that counts
one number and authorizes another.

### The `%25`-first escaping rule

`matricRegistry` and `hotspotLog` both use document IDs built from matrics, and Nigerian
matric numbers contain `/` (`24/56SV002`). `escKeyPart` percent-encodes, and `%` **must**
be first:

```js
.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/\|/g, "%7C")
```

Reordering merges distinct students into one document. See
[SECURITY_MODEL.md](SECURITY_MODEL.md#2-one-matric-one-account).

---

## Roles

There is exactly **one** privileged role today: the **course rep**, identified by
`courses/{id}.repUid == uid`. The rules derive everything from that single field:

```text
isCourseRep(courseId)   -> courses/{id}.repUid == request.auth.uid
isCourseMember(courseId)-> courses/{id}/members/{uid} exists
isCourseStaff(courseId) -> isCourseRep || (isCourseMember && member.role in
                           ['assistant','session_assistant','rep'])
```

`assistant` is a **persistent** delegation; `session_assistant` is a **per-session**
hotspot grant that `close` resets back to `student` (`api/session.js:94`). Both are
granted only through `api/approval.js`, and `session_assistant` additionally requires the
candidate to have already checked in — see
[SECURITY_MODEL.md](SECURITY_MODEL.md#7-hotspot-grants-require-proof-of-presence).

`users.isRep` exists as a profile flag and `departmentReps` as a directory, but neither is
consulted by the rules. `courses.repUid` is the only authorization source.

> **Phase 4 will add `role: "level_anchor"`.** Nothing above should be rebuilt for it —
> anchors are a new *level* of authority that verifies that a rep may exist at all, not a
> replacement for `repUid`. Keeping that separation is what keeps this ruleset small.

---

## Lifecycle of a session

1. **Start** — the rep creates `session/live` + `session/secret`. `secret.attendees` is
   seeded with the rep's own matric via `managerMatric`, and `live.expiresAt` is set.
2. **Rotate** — the client rotates the PIN every `pinRotationInterval` seconds (default
   10), moving the old PIN to `previousPin`. The server re-derives freshness on every
   submission; see [SECURITY_MODEL.md](SECURITY_MODEL.md#1-the-server-clock-is-the-authority).
3. **Check in** — `api/attendance?action=submit`. Verifies token, membership, live
   session, PIN freshness, then runs the atomic transaction.
4. **Flag / approve / grant** — `flagAbsent` marks an empty seat; `approveManual` resolves
   a 3-strike escape hatch; `grantHotspot` delegates PIN-reading.
5. **Close** — `api/session?action=close`. Writes `attendance/session_{ts}` with
   `systemCount` vs `physicalHeadcount`, revokes every `session_assistant`, then deletes
   `session/live` and `session/secret`.
6. **End semester** — `api/semester?action=endSemester`. Clears `session`, `attendance`,
   `checkins`, `deviceFlags` and nulls `activeSession`.

`physicalHeadcount` vs `systemCount` is the low-tech integrity check: a rep counting
heads in the room and comparing against device check-ins makes a bulk-proxy attack visible
even if every automated control were defeated.

---

## Deployment

| Concern | Where |
| --- | --- |
| Serverless functions | `api/*.js` — Vercel, Node runtime |
| Function count | 9 (`account`, `approval`, `attendance`, `course`, `onboarding`, `roster`, `semester`, `session`, `verification`). Vercel Hobby allows 12, so there is headroom |
| Rules deploy | `.github/workflows/deploy-firestore-rules.yml` → `firestore deploy --only firestore:rules` |
| Cache policy | `vercel.json` |
| Env | Vercel project settings — 5 vars, see [`.env.example`](../.env.example) |
| Static assets | `brand/` — optimized static SVG/PNG assets |

---

## Why the Firebase project ID is still `attendify-4c93d`

The rebrand intentionally did **not** touch it. `attendify-4c93d` appears in exactly three
places, all configuration:

- `app.js:376-378` — web config (`authDomain`, `projectId`, `storageBucket`)
- `firebase-messaging-sw.js:10-12` — the service worker's own config
- `.github/workflows/deploy-firestore-rules.yml:42,84` — CI deploy target

A Firebase project ID is immutable and is **not** a display name. Creating a new project
would mean a new Firestore database, new Auth users and re-issued service-account keys —
a full data migration, in exchange for a string that no end user ever sees. The project's
*display* name can be changed in the console if that matters.

The rename was applied with a **case-sensitive** `Attendify` → `VeriPresenX` sweep, which
is why the lowercase project ID survived by construction rather than by luck.

---

## Groundwork for Phases 4–7

Recorded so the next phases do not have to rediscover it.

| Need | Current state | What a later phase must add |
| --- | --- | --- |
| Canonical institution | Free-text `users.institution` / `courses.institution`, compared with `norm()` | **Phase 4:** `institutions/{id}` with `emailDomains[]`; store the ID alongside the display string |
| Canonical department | Free-text, `norm()`-compared (`api/course.js:71`) | **Phase 4:** `departments/{id}` with `{institutionId, slug, faculty}` |
| Level | Free-text string, `norm()`-compared | **Phase 4:** level enum; must match `departmentRosters` keys |
| Level-wide roster | `departmentRosters/{INST}_{DEPT}_{LEVEL}`, written by `api/roster.js` (Phase 4) — import + adviser-chosen rep, read-only to clients | **Phase 5:** rep signup must match `chosenRepMatric`. **Phase 6:** student join must match `matrics[]` |
| Adviser role | Two values, never interchangeable: `role: "adviser"` = applied, **unverified** (`verificationStatus: "pending_email"`); `role: "level_anchor"` = **proven staff** (`"verified"`), written only by `api/verification.js`. `firestore.rules` constrains **create** (no client may assert `level_anchor`/`verified`/`verifiedAt`) **and** pins **update** — both halves are required. `utils/roles.js` holds the vocabulary; `isVerifiedAdviser()` is the only correct gate | **Phase 4:** gate the adviser dashboard on `isVerifiedAdviser(profile)` |
| Rep existence gate | The rep is still chosen by whoever signs up first (`app.js` does a client-side `REP_SLOT_TAKEN` race). The roster now records `chosenRepMatric`, but nothing consults it yet | **Phase 5:** the server grants `role: "rep"` only when the matric matches `chosenRepMatric`, and the client-side race is deleted |

**⚠️ Phase 7 relaxes a security check deliberately.** `api/course.js:69-74` currently
returns a hard `403` on institution/department/level mismatch. Allowing cross-level
electives (GST, service courses) means honoring a rep's approval for a student outside the
roster — so the API must **re-derive and verify that eligibility server-side** before
enrolling, and log the decision. That is a security decision, not a bug fix; see the
checklist at the end of [SECURITY_MODEL.md](SECURITY_MODEL.md).
