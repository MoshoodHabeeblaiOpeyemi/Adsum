# PRESENTATION.md — demo script and launch copy

## The 30-second pitch

> Every Nigerian university already has an attendance problem, and everyone knows it. A
> student signs for a friend. A screenshot of a QR code circulates in a group chat. The
> lecturer has no way to tell.
>
> VeriPresenX verifies **presence**, not attendance. The code rotates every ten seconds
> and only exists on the rep's screen inside the hall. Every check-in is an atomic
> server-side transaction, and one phone cannot sign in a group of friends.
>
> It runs in the browser. No app install, no hardware, no IT project.

---

## Before you demo

| Check | Why |
| --- | --- |
| Two devices (one shows the PIN, one checks in) | The whole point is two-party; a single device undersells it |
| Deployed preview, not `localhost` | `api/*.js` needs the Vercel runtime |
| A Firebase user pre-created as the **rep**, with one course already made | Creating a course live costs 40 seconds of dead air |
| A second user pre-created as a **student** at the same institution/department/level | Enrollment rejects a mismatch (`api/course.js:69-74`), so mismatched demo users will just 403 |
| Screen brightness up on the PIN device | The rotating PIN is the visual centrepiece |
| Wi-Fi you do not depend on | Check-in is online-first by design; a dead venue network is the one thing that breaks the demo |

---

## Demo script (~4 minutes)

### 1. The splash (15 s)

Open the deployed URL. The splash shows the VeriPresenX mark and "Click anywhere to
continue". Note the install prompt — it is a PWA, so it installs from the browser.

**Say:** "No app store, no install friction. It is a website that behaves like an app."

### 2. Signup and the roles (30 s)

Show the signup screen. Point out the field that changes the account type — a student
signing up as a **course rep** versus a plain **student**.

**Say:** "There are two roles. A rep runs the session for their course. Students join a
course with a code, like a class group."

### 3. The rep starts a session (45 s)

On the rep device: open the course, start a session.

The PIN panel appears with the code and a live countdown under it.

**Say:** "That is the code. It rotates every ten seconds. Watch the countdown."

Wait for a rotation and let the number visibly change.

**Say:** "A screenshot taken right now is worthless in ten seconds. That single property
is what kills the group-chat QR problem."

### 4. The student checks in (45 s)

On the second device, as the student: enter the course and the PIN currently on screen.

Show the live roster updating on the rep's device.

**Say:** "The interesting part is not the code — it is what happens after. That check-in
was one atomic transaction on the server. It verified the token, checked the PIN had not
expired, confirmed this matric had not already checked in, and wrote the record. All of it
in one unit."

### 5. Try to cheat — live (45 s)

The moment that lands. Ask the room to suggest a cheat.

- **"Send the PIN to a friend at home."** Send it. It is already stale — the submission
  comes back "PIN has expired". Read the error out loud.
- **"Check in twice."** Try. The transaction refuses: already checked in.
- **"Sign in for my friend on my phone."** Do it. Then open the flagged-devices panel.

**Say:** "It grouped those by physical device, not by student. One phone claiming six
people is one finding, not six noise rows."

### 6. Close the session honestly (30 s)

Close the session and enter a **physical headcount** lower than the system count.

**Say:** "This is the low-tech backstop. The rep counts heads in the room. If the system
counts forty and the room holds twenty-two, that is visible on the record forever — and
attendance records are written server-side, so nobody can quietly edit the number
afterwards."

### 7. The honest close (20 s)

Do not hide the gaps. Naming them builds more trust than perfection does.

**Say:** "Two things are still open, and I keep them written down in the repo's security
model rather than buried. First, course documents are readable by any signed-in account,
and those documents carry the enrolled matric numbers — fixing that properly needs a
separate public catalog and a private roster, because course discovery is how a student
joins in the first place. Second, GPS geofencing is a deterrent, not proof of presence: a
rooted device can report coordinates it is not standing at. The counter to that is the
physical headcount on close, which is why it exists."

---

## LinkedIn post

> I have been building an anti-proxy attendance system for months. It has been called
> Attendify. But I recently discovered that name is used by several other products, so I
> am rebranding.
>
> New name: **VeriPresenX** — because that is what it does. Verifies presence. Not just a
> login. Not just a code. Actual, physical, verified presence.
>
> The problem is old and embarrassing. A student signs for a friend. A QR code screenshot
> travels through a group chat. Every lecturer in Nigeria knows it happens and has no way
> to prove it.
>
> What VeriPresenX does differently:
>
> - The check-in code rotates every 10 seconds, and only exists on the rep's screen inside
>   the hall. A forwarded code is dead on arrival.
> - Every check-in is an atomic server-side transaction. Duplicates are impossible, and
>   clients cannot write attendance at all.
> - One physical device cannot check in a group. Attempts are grouped by device and
>   surfaced to the rep.
> - A rep's headcount is recorded next to the system count, so a bulk proxy attempt stays
>   visible in the record permanently.
>
> It runs in the browser. No app install, no biometric hardware, no IT project to procure.
>
> Same mission. Same code. New name. Repo updating this week.

### Shorter variant

> Rebranding: Attendify → **VeriPresenX**.
>
> Same mission — verifies physical presence, not logins. A rotating code that dies in 10
> seconds, atomic server-side check-ins, and one device that cannot sign in a group.
>
> Browser-based. No hardware. No install.
