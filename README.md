# Adsum

**I am present.** A browser-based, server-authoritative attendance system for
Nigerian universities. Students check in against a rotating code that is only legible
from inside the hall, and every check-in is an atomic server-side transaction.

> *Adsum* is Latin for "I am present" — the answer a Roman student gave when called
> during roll call.
>
> Formerly **VeriPresenX**, and before that **Attendify** — both renamed for
> trademark safety, since unrelated products already used those names. The Firebase
> project ID remains `attendify-4c93d`; see
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## The problem it actually solves

Proxy attendance — "I signed for you" — is the core failure of paper and QR systems.
Adsum attacks it at four independent points, so defeating one is not enough:

| Control | What it stops |
| --- | --- |
| **Rotating PIN** (default 10 s) rendered only on the rep's screen in the hall | Screenshot-and-forward. A forwarded PIN is stale within seconds |
| **Atomic server transaction** on every check-in | Double check-in, duplicate rows, roster/attendee divergence |
| **Device lock** — one physical device, many accounts | A single phone checking in a group of friends |
| **Server-authoritative writes** — clients cannot write attendance at all | Anyone crafting a Firestore write from devtools |

Deliberately **online-first**. The server clock is the anti-cheat authority, so there is
no offline queue — see [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

---

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | Vanilla JS PWA — **no framework, no build step** | `index.html`, `app.js`, `style.css`, `sw.js` |
| Backend | Vercel serverless functions | `api/*.js`, Node + Firebase Admin SDK |
| Data | Firestore + `firestore.rules` | Rules are the real access boundary |
| Auth | Firebase Auth (email/password) | ID token verified on every endpoint |
| Push | Firebase Cloud Messaging | `firebase-messaging-sw.js` |
| Brand assets | Web-optimized PNG / WebP icons and mark | `brand/` |

There is no bundler, no transpiler and no npm dependency in the shipped app.
`package.json` lists `firebase-admin` only because Vercel resolves it for `api/*.js`.

---

## Quick start

**Prerequisites:** Node 18+, a Firebase project with Firestore + Auth enabled, and a
service-account key for that project.

```powershell
git clone <repo-url>
cd "ATTENDIFY APP"

npm install          # resolves firebase-admin for the api/ functions
Copy-Item .env.example .env    # then fill in the five values
```

1. **Web config** — set the Firebase web config inline in `app.js` (~line 373) and in
   `firebase-messaging-sw.js`. These values are public by design; they are not secrets.
2. **Env** — fill `.env` from the service-account JSON. See [`.env.example`](.env.example).
3. **Rules** — deploy them before using the app:

   ```powershell
   firebase deploy --only firestore:rules
   ```

4. **Run** — the `api/*.js` handlers need the Vercel runtime, so a plain static server
   will serve the UI but every API call 404s:

   ```powershell
   npx.cmd vercel dev
   ```

   On Windows PowerShell use `npx.cmd` — the `.ps1` shim is blocked by the default
   ExecutionPolicy.

### Deploy

Vercel builds from the repo; `vercel.json` sends `Cache-Control: no-cache` for
`/`, `index.html`, `app.js`, `style.css` and `sw.js`. That is deliberate: a new deploy
must never be served against a cached service worker. Firestore rules deploy through
[`.github/workflows/deploy-firestore-rules.yml`](.github/workflows/deploy-firestore-rules.yml).

Set the five env vars in **Vercel → Settings → Environment Variables**.

---

## How a session works

```text
REP                                    SERVER                         STUDENT
────────────────────────────────────────────────────────────────────────────────────
create course (code/dept/level)
start session  ─────────────────────►  write session/live
                                       write session/secret {pin, attendees:[rep]}
PIN + countdown on screen
  rotate every 10s ──────────────────►  {pin, previousPin, pinRotationTime}
                                                                      read PIN off screen
                                       ◄───────────────────────────  POST /attendance?submit
                                       verify token + App Check
                                       recompute freshness from pinAge
                                       runTransaction:
                                         reject if matric already in attendees
                                         write checkins/{uid}_{ts}
                                         union matric into secret.attendees
                                       ─────────────────────────►  ✅
close session + physical headcount ──►  write attendance/session_<ts>
  compare system vs physical count      delete session/live + session/secret
```

The check-in race is closed inside the transaction, not by the client: the
`attendees.includes(matric)` test and the write happen in the same atomic unit, so two
concurrent requests from one matric cannot both succeed.

---

## Project structure

```text
api/                     Serverless endpoints for account, roster, course and attendance workflows
utils/appCheck.js        App Check gate — called FIRST by every endpoint
app.js                   the entire client (~7 500 lines, no framework)
index.html               markup + all screen containers
style.css                theming via :root and data-theme="dark"
sw.js                    service worker; cache-first for static assets
firebase-messaging-sw.js FCM background handler
firestore.rules          the access boundary — read this before changing data shapes
vercel.json              cache headers
brand/                   logo, mark, wordmark, app icons and preview sheet
docs/                    architecture, security model, roadmap
```

### API surface

| Function | Actions |
| --- | --- |
| `api/account.js` | `claimMatric`, `deleteAccount` |
| `api/approval.js` | `requestManual`, `approveManual`, `grantHotspot` |
| `api/attendance.js` | `submit`, `flagAbsent` |
| `api/course.js` | `enroll`, `leave`, `remove`, `delete` |
| `api/onboarding.js` | `createProfile` |
| `api/prune-advisers.js` | Scheduled cleanup of unverified adviser applications |
| `api/roster.js` | `importRoster`, `chooseRep`, `getRoster`, `endAcademicSession` |
| `api/semester.js` | `endSemester` |
| `api/session.js` | `close`, `registerDevice`, `rotatePin`, `startSession` |
| `api/verification.js` | `sendCode`, `verifyCode`, `verifyNIN` |

Called as `POST /api/<function>?action=<action>` with `Authorization: Bearer <idToken>`.

---

## Documentation

| Doc | Read it when |
| --- | --- |
| [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) | **Before changing anything in `api/` or `firestore.rules`.** Freezes the invariants four audit rounds established |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | You need the data model, collection by collection |
| [docs/ROADMAP.md](docs/ROADMAP.md) | You want to know what is next and why |
| [PRESENTATION.md](PRESENTATION.md) | You are demoing or writing the launch post |
| [brand/README.md](brand/README.md) | You are touching logos or icons |

### Verify before committing

`check.js` parses browser files as **ES modules** — which `node --check` cannot
do. `node --check app.js` throws on the first `import`, stops, and **reports
success on a file that does not parse**; a stray comma in a ternary once shipped
through several rounds of review because of that blind spot.

```bash
npm run check
```

If the PowerShell execution policy blocks the `npm` shim, run node directly:

```bash
node --experimental-vm-modules check.js
```

### Verify the rules before they ship

`check.js` cannot validate `firestore.rules` — it parses JavaScript, not the rules
language — and those rules deploy to production **automatically** on a push to `main`
(`.github/workflows/deploy-firestore-rules.yml`), with no validation step of their own.
`rules-test.js` closes that gap by running the rules against the Firestore emulator and
asserting **both** directions, so a check that should deny but allows (a hole) and one
that should allow but denies (a regression) each fail the run.

```bash
# 1. start the emulator with the rules under test (jar cached by the Firebase CLI)
java -jar "$HOME/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar" \
     --rules firestore.rules --port 8080

# 2. run the checks (Node 18+)
npm run test:rules
```

This is not decorative. It found that the proof-of-presence guard on session hotspots
existed on `members` `update` but not `create`, which let a rep hand a student who never
scanned in a row that — because `session_assistant` counts as course staff — also read
`session/secret`, the live rotating PIN. Against the previous rules it fails **9** checks.

---

## Status

**Functionally complete PWA, demo-ready.** Hardened through four internal audit rounds plus
the Phase 5 server-authority work: PIN rotation, the submission throttle, the
manual-request threshold and course creation are all enforced server-side, and the session
and PIN documents are backend-only. Remaining gaps are catalogued honestly in
[docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md#known-gaps) — notably that any signed-in
account can read course documents, and that GPS geofencing is a deterrent rather than proof
of physical presence.
