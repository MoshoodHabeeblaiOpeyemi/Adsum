# Security model — frozen invariants

**Read this before changing anything in `api/` or `firestore.rules`.**

Adsum has been through four internal audit rounds. The rules below are not
suggestions; each one closes a specific attack that was found and fixed. Reverting one
reopens a hole that is invisible in normal use — the app will keep working perfectly
while the anti-cheat property it depended on quietly disappears.

---

## 1. The server clock is the authority

**Invariant.** PIN freshness is computed server-side from `pinAge`, never trusted from
the client.

```js
// api/attendance.js:39-45
const pinAge = Date.now() - (secret.pinRotationTime || 0);
const pinRotationIntervalMs = (live.pinRotationInterval || 10) * 1000;
const isCurrentPinFresh = pinAge < pinRotationIntervalMs * 2;
const isCurrentPinValid = submittedPin === secret.pin && isCurrentPinFresh;
const isPreviousPinValid = submittedPin === secret.previousPin && pinAge < pinRotationIntervalMs * 3;
```

**Why the multipliers exist.** A student standing in the hall types a PIN that rotates
mid-entry. Without tolerance the code expires between reading it and submitting it, and
the honest student is punished for latency. The windows are therefore:

| PIN | Valid while | Purpose |
| --- | --- | --- |
| current | `pinAge < interval × 2` | one full rotation of slack for typing + network |
| previous | `pinAge < interval × 3` | the rotation straddled the student's submission |

**Do not tighten these to a single interval.** It converts network latency into failed
check-ins. Equally, **do not widen them** without a specific reason: they are the entire
screenshot-relay defence.

**Expired-vs-invalid is a distinct response.** A correct-but-stale PIN returns
`401 { pinExpired: true }` so the UI can say "use the latest PIN" instead of "invalid
PIN". Preserve that distinction; collapsing the two turns a usable error into a
confusing one.

### Phase 5 must not break this

`app.js:6265` sets `session.pinRotationTime = Date.now()` **on the rep's device** and
writes it at `app.js:6279`. So today the rep's browser, not the server, decides the
timestamp the server later trusts. Moving the write to `serverTimestamp()` is the fix —
but `serverTimestamp()` is a **sentinel object, not a number**. `Date.now() - ts` yields
`NaN`, and `NaN < anything` is `false`, so every check-in would fail closed. The
authoritative version must read the resolved value:

```js
const resolved = secret.pinRotationTime;          // Firestore Timestamp after write
const age = Date.now() - resolved.toMillis();     // ⚠️ .toMillis(), not arithmetic on the sentinel
```

Add a small clock-skew grace window at the same time — serverless regions and Firestore
timestamps can disagree by a few hundred milliseconds, which is enough to reject an
honest check-in at the boundary.

---

## 2. One matric, one account

`matricRegistry/{institution|matric}` maps a matric number to exactly one uid, claimed
inside a transaction so two simultaneous claims cannot both win:

```js
// api/account.js:71-75
const snap = await tx.get(regRef);
if (snap.exists && snap.data().uid !== decoded.uid) throw new Error("MATRIC_CLAIMED_BY_ANOTHER");
tx.set(regRef, { uid, matric, institution, department, level, claimedAt: serverTimestamp() }, { merge: true });
```

**The escaping is load-bearing.** Firestore document IDs cannot contain `/`, and Nigerian
matric numbers routinely do (`24/56SV002`). The key builder percent-encodes, and `%` must
be encoded **first** so the mapping stays reversible and no two distinct matrics collapse
into the same document:

```js
const escKeyPart = (v) => String(v||"").trim().toUpperCase()
  .replace(/%/g, "%25")   // ⚠️ FIRST — otherwise a literal "%2F" in input
  .replace(/\//g, "%2F")  //    could collide with an encoded "/"
  .replace(/\|/g, "%7C"); // separator, must not appear in a part
```

Reordering those three `.replace()` calls silently merges distinct students. There is a
regression test worth writing here: `escKeyPart("A/B")` and `escKeyPart("A%2FB")` must
differ.

`matricRegistry` is backend-only — `allow read, write: if false`. Clients cannot forge a
claim, and reads are unnecessary because enrollment and claiming are checked server-side.

---

## 3. Attendance is one atomic unit

The duplicate test and the write happen in the same transaction, so concurrent requests
cannot both pass:

```js
// api/attendance.js:58-63, 88-89
await db.runTransaction(async (tx) => {
  const secretSnap = await tx.get(secretRef);
  if ((secretSnap.data().attendees || []).includes(matric)) throw new Error("ALREADY_CHECKED_IN");
  tx.set(checkinRef, { uid, matric, checkedInAt: serverTimestamp(), lat, lon, accuracy });
  tx.update(secretRef, { attendees: FieldValue.arrayUnion(matric) });
});
```

**The rep is seeded into `secret.attendees` at session creation** and carried into the
course-doc union, so the student-facing roster shows them present even if a
publish/merge race dropped their own entry. That is why a rep appears present on every
live roster without checking in.

**`FieldValue.arrayUnion` is what makes this idempotent.** A retried request unions the
same value instead of appending a duplicate.

---

## 4. Clients cannot write attendance

Enforced in `firestore.rules`, not in the client:

| Collection | Rule | Reasoning |
| --- | --- | --- |
| `courses/{id}/checkins` | `allow write: if false` | Per-student rows, backend-only |
| `courses/{id}/attendance` | `allow write: if false` | Closed-session summaries |
| `courses/{id}/deviceFlags` | `allow write: if false` | Fraud evidence |
| `courses/{id}/absentFlags` | `allow create, update, delete: if false` | Permanent, unforgeable |
| `courses/{id}/removalLog` | `allow write: if false` | Audit trail |
| `courses/{id}/hotspotLog` | `allow write: if false` | Transparency log |
| `matricRegistry/*` | `allow read, write: if false` | Claim integrity |

Removal is also logged: `api/course.js:166` writes `removalLog` so a student cannot be
quietly deleted from a roster.

---

## 5. Device lock

`registerDevice` issues the `att_device` cookie (HttpOnly, Secure, SameSite=Lax, 1 year)
and `devices/{u_uid}` maps one physical device to one identity. `deviceFlags` then detects
**multiple accounts on one device**, and the UI groups flags by physical device
(`app.js:7255`) rather than by student — a phone shared by six accounts is one finding,
not six.

**⚠️ The localStorage keys carry a rename chain, and it must not be shortened.**
The app has been renamed twice, so `readLocalWithMigration(newKey, legacyKey, olderLegacyKey)`
walks three generations: `adsum_*` → `veripresenx_*` → `attendify_*`. `adsum_device_uuid`
feeds this device lock — dropping a generation would make every existing user look like a
brand-new device, which is indistinguishable from the fraud this feature exists to detect.

The same chain now protects `adsum_account_created`, the device-tracked "has this device
ever signed up" flag. That one is a convenience regression rather than a security hole, but
it is the same bug shape: a returning user silently lands on the role picker instead of Sign
in. When a fourth rename happens, add its key as the new `legacyKey` and push the current
one down — do not replace the legacy argument.

---

## 6. App Check

Every endpoint calls `verifyAppCheck(req)` **before** touching the ID token
(`api/attendance.js:156`, `api/session.js:139`), so an unverified caller is rejected
before any auth work happens.

Soft mode is the default: when `ENFORCE_APP_CHECK !== "true"` it is a no-op. Hard mode
requires a valid `x-firebase-appcheck` token or returns 401.

**Order matters when enabling it.** `app.js:408` has `const APP_CHECK_SITE_KEY = ""`.
While that is empty the client sends no token, so flipping the env var first locks out
every user. Register the app in the console, set the site key, confirm verified traffic,
and only then set the env var.

---

## 7. Hotspot grants require proof of presence

`grantHotspot` lets a rep delegate PIN-reading to an assistant to spread the crowd. Two
guards, in both layers:

1. **The target must already be in `secret.attendees`.** You cannot scan the rep's screen
   from home, so an absent friend can never be handed the rotating code.
2. **Max 5 grants per session**, enforced by a counted query
   (`api/approval.js:116-117`).

`firestore.rules:143-147` re-checks the same condition for direct client writes — defence
in depth, because a rule-only or API-only guard fails open if the other is bypassed.

Every grant is written to `hotspotLog`, readable by **every enrolled student**, so the
delegation is public and auditable: who was granted, when, and by whom.

---

## 8. Absent flags are permanent

`flagAbsent` (`api/attendance.js:103`) requires rep-or-assistant, forbids
self-flagging, and refuses a duplicate **within the same session** — keyed on
`sessionExpiresAt`, so week 3 cannot poison week 4. Flags can never be deleted by
anyone, in either layer. The affected student receives an emergency notification; that is
the point of "anti-beef": a flag raises an alert that cannot be quietly retracted.

---

## 9. The 3-strike fail-safe

After three failed check-ins in the current session, a student may request manual
verification. The browser's local counter only controls button visibility; it is not
trusted for eligibility. `api/attendance.js` records failures in backend-only
`pinAttempts/{uid}_{courseId}`, bound to the session expiry, and
`api/approval?action=requestManual` checks that counter and current membership
transactionally before creating the request. Direct client creation is denied by
`firestore.rules`. `approveManual` rechecks pending status, session, enrollment, and
already-checked-in state in the transaction that records attendance. A staff member must
still confirm the student physically; manual verification does not automatically approve
attendance.

---

## 10. Errors never leak internals

The module boundary catches everything and returns a generic message:

```js
} catch (error) {
  console.error("Attendance API error:", error);            // full detail server-side
  return res.status(500).json({ error: "Server error" });   // nothing client-side
}
```

Handler-level messages are safe-by-design (`"Invalid PIN."`, `"No live session."`) because
they describe the caller's own state and reveal nothing about other users or the schema.
**Do not** let a raw `error.message` reach a 500 response body.

**Reads before writes.** `api/approval.js:127-130` documents the reason explicitly:
granter identity is read *outside* the transaction because plain reads inside a `tx` block
give no consistency guarantee across transaction retries.

---

## Frozen invariants

Rules that later phases must not regress. Each is enforced in code, not by
convention.

### An account is never born an authority

`firestore.rules` **constrains `create` and pins `update`**. Both are required:

- `create` — a client may only write the unprivileged end of the role model.
  `role` must be one of `student` / `rep` / `adviser`; `verificationStatus` only
  `not_required` / `pending_email`; `verifiedAt` and `verificationMethod` must be
  `null`; `isAdviser` must agree with `role`; an adviser must not carry a matric.
- `update` — those same fields are pinned against the existing document, so an
  account cannot climb after the fact.

> **Why both.** Pinning only `update` looked sufficient and was not. A brand-new
> document has no prior value to compare against, so a `create` rule that merely
> checked `matric is string` let a tampered client mint
> `role: "level_anchor" / verificationStatus: "verified"` outright — an account
> born an anchor that never passed an email check. Only
> `api/verification.js` (Admin SDK, bypasses rules) may write those values.

### One vocabulary, one gate

`role: "adviser"` means *applied, unverified*; `role: "level_anchor"` means
*proven staff*. They are not interchangeable, and the failure mode is silent:
a gate written as `role === "adviser"` compiles, looks correct, and admits every
unverified applicant.

`utils/roles.js` therefore owns the values, and `isVerifiedAdviser(profile)` is
the only correct authorisation test. It requires **both** the minted role and the
verified status, so any partial state fails closed. Use `isAdviserTrack()` only
for "may I start verification", never for "may I use adviser powers".

Display strings ("Level Adviser") live separately in `ROLE_LABEL` (`app.js`) so
UI wording can change without touching stored data.

---

## Known gaps

Recorded honestly; resolved items are marked, and remaining risks are explicit.

| Gap | Impact | Fix |
| --- | --- | --- |
| PIN rotation timestamp is client-written (`app.js:6279`) | A rep with devtools could backdate `pinRotationTime` to keep a PIN alive | ✅ **Fixed (Phase 5).** `api/session?action=rotatePin` generates the PIN with `crypto.randomInt` and stamps `serverTimestamp()`. The client can neither backdate it nor predict the next PIN |
| Any signed-in user could create a course claiming `repUid` | A student could self-appoint as a course rep through the Firestore SDK | ✅ **Fixed.** Course creation requires an adviser-granted rep profile, matching department scope, and an empty initial session/roster |
| Manual-request threshold is client-side | LocalStorage controls only when the request button appears; direct request creation would bypass the three-failure threshold | ✅ **Fixed.** Backend-only `pinAttempts` records session-bound failures; `requestManual` enforces the threshold, and Firestore denies direct client creation |
| Hotspot proof-of-presence guarded `update` but not `create` | A rep could skip `grantHotspot` and `setDoc` a fresh `members` row with `role: "session_assistant"` for a student who never scanned in. Because `session_assistant` counts as course staff in `isCourseStaff()`, that row also granted its owner read access to `session/secret` — the live rotating PIN. Found by `rules-test.js`, which failed 9 checks against the previous rules | ✅ **Fixed.** `members` `create` now carries the same live-session + attendee test as `update`, and `matric` is pinned on `update` so the proof cannot be redirected to a scanned-in classmate |
| GPS location authenticity | Server validates submitted coordinates against the hall, but a rooted/mock-location device can still forge its reported location | GPS remains disabled on web by default (`GPS_ATTENDANCE_ENABLED` must be explicitly enabled); geofencing is a deterrent, not proof of physical presence |
| Course catalog reads are `signedIn()` | Any account can read any course doc, including `enrolled[]` matric numbers | Restrict to members/staff, or split the roster into a subcollection. **Not done:** it breaks course discovery, which is how a student joins in the first place |
| No rate limit on PIN submission | A 4–6 digit PIN could be brute-forced within the freshness window | ✅ **Fixed (Phase 5).** 5 misses per uid+course per 30s, incremented **inside a transaction** — a read-then-write limiter has a race, and 50 parallel requests would each read `count: 0` |
| Screenshot/leave-app signals are advisory | `securityEvents` records attempts but nothing acts on them | Weight them into a risk score |

---

## Checklist for any change to `api/` or `firestore.rules`

1. Verify the ID token **first**; `verifyAppCheck` before that.
2. Read every document you need **before** the first write in a transaction.
3. Never trust a client-supplied timestamp, count, or identity claim.
4. Log failures with detail server-side; return generic text to the client.
5. New user data entering the DOM goes through `escapeHTML()`.
6. If you relax a rule or a 403, say so in the commit message and here — a relaxed
   check is a security decision, not a bug fix.
7. Run `npm run check` **and** `npm run test:rules` before pushing. `firestore.rules`
   deploys to the live project automatically on a push to `main`, and the deploy
   workflow runs no validation of its own — so the second command is the only thing
   standing between an edit and an enforceable hole in production. It needs the
   Firestore emulator running with `--rules firestore.rules`; the header of
   `rules-test.js` has the exact command.
8. Add the assertion to `rules-test.js` in the same commit as the rule it covers.
   Both directions matter: a check that should deny but allows is a hole, and one
   that should allow but denies is an outage.
