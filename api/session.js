const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");
const { toMillis, generatePin } = require("../utils/geo");

try {
  if (getApps().length === 0) {
    initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
  }
} catch (error) { if (!/already exists/.test(error.message)) console.error("Firebase Admin Init Error:", error); }

const db = getFirestore();

function readCookie(header, name) {
  const hit = String(header || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
  if (!hit) return null;
  const raw = hit.split("=", 2)[1] || "";
  try { return decodeURIComponent(raw); } catch (_) { return raw; }
}


/**
 * 🔒 Rotate the session PIN — SERVER-AUTHORITATIVE.
 *
 * Until Phase 5 this ran entirely in the rep's browser: `app.js` generated the
 * new PIN with `Math.random()` and wrote `pinRotationTime: Date.now()` to
 * Firestore. The server then trusted that timestamp when deciding whether a PIN
 * was still fresh. Two separate failures followed from that:
 *
 *   1. A rep with devtools could backdate `pinRotationTime` and freeze a PIN
 *      alive indefinitely, defeating the entire anti-relay mechanism.
 *   2. `Math.random()` is not a CSPRNG. Its output is predictable from a few
 *      observed values, so an attacker watching one rotation could predict the
 *      next ones and pre-compute a valid submission.
 *
 * Both are now impossible from the client: the PIN is generated here with
 * `crypto.randomInt`, and the timestamp is `serverTimestamp()`, which the
 * rep's browser cannot forge.
 *
 * ⚠️ THE READ-BACK TRAP — this is the part that bites.
 * `FieldValue.serverTimestamp()` is a SENTINEL, not a value. It only becomes a
 * real Timestamp when the document is read back. Any code doing arithmetic on
 * the field must call `.toMillis()`:
 *
 *     const age = Date.now() - secret.pinRotationTime;   // ❌ NaN
 *     const age = Date.now() - secret.pinRotationTime.toMillis();  // ✅
 *
 * A NaN age makes every freshness comparison silently FALSE, which fails OPEN
 * on the next check. api/attendance.js reads this field ONLY through
 * `ageMs()` in utils/geo.js, which handles the Timestamp, a legacy number, and
 * the "absent/corrupt → treat as expired" case.
 */
async function handleRotatePin(req, res, decoded) {
  try {
    const { courseId } = req.body || {};
    if (!courseId || typeof courseId !== "string")
      return res.status(400).json({ error: "Course ID is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const memberSnap = await courseRef.collection("members").doc(decoded.uid).get();
    const isRep = courseData.repUid === decoded.uid;
    const isAssistant = memberSnap.exists && memberSnap.data().role === "assistant";
    if (!isRep && !isAssistant)
      return res.status(403).json({ error: "Only course staff can rotate the PIN." });

    const liveRef = courseRef.collection("session").doc("live");
    const liveSnap = await liveRef.get();
    if (!liveSnap.exists) return res.status(403).json({ error: "No live session." });
    const live = liveSnap.data();
    if (live.expiresAt && Date.now() > live.expiresAt)
      return res.status(403).json({ error: "Session expired." });

    const secretRef = courseRef.collection("session").doc("secret");

    // Read + write in ONE transaction so two rotations racing (two rep devices,
    // or a double-tap) cannot interleave and lose one of the two updates.
    let newPin = null;
    await db.runTransaction(async (tx) => {
      const secretSnap = await tx.get(secretRef);
      const secret = secretSnap.exists ? secretSnap.data() : {};
      const next = generatePin(4);
      tx.set(secretRef, {
        pin: next,
        previousPin: secret.pin || null,
        // 🔒 Server clock. The client cannot backdate this.
        pinRotationTime: FieldValue.serverTimestamp(),
      }, { merge: true });
      newPin = next;
    });

    // Read the written timestamp back so the caller gets a real value, not the
    // sentinel. This is the only correct way to hand a time to the client.
    const after = await secretRef.get();
    const afterData = after.exists ? after.data() : {};
    const millis = toMillis(afterData.pinRotationTime);

    return res.status(200).json({
      success: true,
      pin: newPin,
      previousPin: afterData.previousPin || null,
      // Returned as epoch ms so the client does not have to guess the shape.
      pinRotationTime: millis === null ? Date.now() : millis,
      serverNow: Date.now(),
      pinRotationInterval: live.pinRotationInterval || 10,
    });
  } catch (error) {
    console.error("Rotate PIN error:", error);
    return res.status(500).json({ error: "Unable to rotate the PIN." });
  }
}

/**
 * 🔒 START a session — the SERVER picks the first PIN and stamps the clock.
 *
 * This exists because `rotatePin` cannot be used to open a session: it requires
 * a live session to already exist. Until this endpoint existed, the FIRST PIN of
 * every session was still generated in the rep's browser with
 * `Math.floor(1000 + Math.random() * 9000)` and stamped with the client's
 * `Date.now() + serverClockSkewMs` — which is the same forgeable clock Phase 5
 * removed everywhere else. The first PIN is exactly the one a relay attacker
 * wants to capture, so leaving it client-generated kept the headline hole open
 * for the first 10 seconds of every class.
 *
 * The client sends only the things the SERVER cannot know: the hall, the
 * duration, and the rep's own matric. The PIN and the timestamp are minted here.
 */
async function handleStartSession(req, res, decoded) {
  try {
    const { courseId, managerMatric, lat, lon, radius, hallName, durationSeconds, locationMode, qrMode } = req.body || {};
    if (!courseId || typeof courseId !== "string")
      return res.status(400).json({ error: "Course ID is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const memberSnap = await courseRef.collection("members").doc(decoded.uid).get();
    const isRep = courseSnap.data().repUid === decoded.uid;
    const isAssistant = memberSnap.exists && memberSnap.data().role === "assistant";
    if (!isRep && !isAssistant)
      return res.status(403).json({ error: "Only course staff can start a session." });

    const profile = await db.collection("users").doc(decoded.uid).get();
    const ownerMatric = String((profile.exists && profile.data().matric) || "").trim().toUpperCase();
    const seeded = String(managerMatric || ownerMatric || "").trim().toUpperCase();
    if (!seeded) return res.status(400).json({ error: "A rep matric number is required." });

    // 🛑 Archive any previous session atomically. Doing this read OUTSIDE the
    // transaction would let a concurrent close/regenerate interleave and drop
    // the earlier attendees.
    const liveRef = courseRef.collection("session").doc("live");
    const secretRef = courseRef.collection("session").doc("secret");
    const liveSnap = await liveRef.get();
    if (liveSnap.exists) {
      return res.status(409).json({
        error: "A session is already live. Close it before starting another.",
        code: "SESSION_ALREADY_LIVE",
      });
    }

    const num = (v, dflt) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
    const duration = Math.min(Math.max(num(durationSeconds, 300), 30), 3600);
    const mode = ["no_gps", "gps", "hall"].includes(locationMode) ? locationMode : "no_gps";
    const nowMs = Date.now();
    const expiresAt = nowMs + duration * 1000;
    const pin = generatePin(4);

    const batch = db.batch();
    batch.set(liveRef, {
      active: true,
      expiresAt,
      durationSeconds: duration,
      pinRotationInterval: 10,
      locationMode: mode,
      qrMode: qrMode === true,
      hallName: hallName ? String(hallName).slice(0, 120) : null,
      generatedAt: FieldValue.serverTimestamp(),
      startedBy: decoded.uid,
    });
    batch.set(secretRef, {
      pin,
      previousPin: null,
      // 🔒 Server clock. The client cannot forge or backdate this.
      pinRotationTime: FieldValue.serverTimestamp(),
      locationMode: mode,
      qrMode: qrMode === true,
      lat: num(lat, null),
      lon: num(lon, null),
      radius: num(radius, 80),
      attendees: [seeded],
      // Transparency: the archive records WHO was auto-marked as the session
      // creator, so the "Present" list always shows scanned vs vouched-for.
      managerMatric: seeded,
    });
    batch.update(courseRef, {
      activeSession: {
        pin,
        previousPin: null,
        // A number, already resolved server-side, so the client can count down.
        pinRotationTime: nowMs,
        expiresAt,
        expired: false,
        attendees: [seeded],
        locationMode: mode,
        qrMode: qrMode === true,
        lat: num(lat, null),
        lon: num(lon, null),
        radius: num(radius, 80),
        hallName: hallName ? String(hallName).slice(0, 120) : null,
        sessionDuration: duration,
        pinRotationInterval: 10,
      },
    });
    await batch.commit();

    return res.status(200).json({
      success: true,
      pin,
      pinRotationTime: nowMs,
      serverNow: nowMs,
      expiresAt,
      sessionDuration: duration,
      pinRotationInterval: 10,
      managerMatric: seeded,
      locationMode: mode,
    });
  } catch (error) {
    console.error("Start session error:", error);
    return res.status(500).json({ error: "Unable to start the session. Please try again." });
  }
}

async function handleClose(req, res, decoded) {
  try {
    const { courseId, physicalHeadcount } = req.body || {};
    if (!courseId || typeof courseId !== "string")
      return res.status(400).json({ error: "Course ID is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const memberSnap = await courseRef.collection("members").doc(decoded.uid).get();
    const isRep = courseData.repUid === decoded.uid;
    const isAssistant = memberSnap.exists && memberSnap.data().role === "assistant";

    if (!isRep && !isAssistant) return res.status(403).json({ error: "Only course staff can close a session." });

    const secretRef = courseRef.collection("session").doc("secret");
    const secretSnap = await secretRef.get();
    const attendees = secretSnap.exists ? (secretSnap.data().attendees || []) : [];
    const now = new Date();
    const dateLabel = now.toLocaleDateString("en-GB") + " " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const rawHeadcount = physicalHeadcount;
    const headcount = typeof rawHeadcount === "number" && Number.isInteger(rawHeadcount) && rawHeadcount >= 0 ? rawHeadcount : null;

    const liveSnap = await courseRef.collection("session").doc("live").get();
    const sessionExpiresAt = liveSnap.exists ? liveSnap.data().expiresAt || null : null;

    let flaggedAbsent = [];
    if (sessionExpiresAt) {
      const flagsSnap = await courseRef.collection("absentFlags").where("sessionExpiresAt", "==", sessionExpiresAt).get();
      flaggedAbsent = flagsSnap.docs.map((d) => d.data().matric).filter(Boolean);
    }

    let attendeeGroups = {};
    try {
      const groupsSnap = await courseRef.collection("groups").get();
      groupsSnap.docs.forEach((g) => {
        const members = g.data().members || [];
        members.forEach((m) => { if (m.matric) attendeeGroups[String(m.matric).toUpperCase()] = g.data().name; });
      });
    } catch (_) { }

    const secretManagerMatric = secretSnap.exists ? String(secretSnap.data().managerMatric || "").trim().toUpperCase() || null : null;
    const autoMarked = secretManagerMatric ? [{ matric: secretManagerMatric, reason: "session_creator" }] : [];

    let sessionhotspots = [];
    if (sessionExpiresAt) {
      try {
        const rlSnap = await courseRef.collection("hotspotLog").where("sessionExpiresAt", "==", sessionExpiresAt).get();
        sessionhotspots = rlSnap.docs.map((d) => {
          const v = d.data();
          return { matric: v.matric || "", name: v.name || "", grantedByMatric: v.grantedByMatric || "", grantedAt: v.grantedAt && v.grantedAt.toDate ? v.grantedAt.toDate().toISOString() : null };
        });
      } catch (_) { }
    }

    const sessionKey = `session_${now.getTime()}`;
    await courseRef.collection("attendance").doc(sessionKey).set({
      date: dateLabel, closedAt: FieldValue.serverTimestamp(), closedBy: decoded.uid,
      attendees, attendeeGroups, systemCount: attendees.length, physicalHeadcount: headcount,
      flaggedAbsent, autoMarked, hotspots: sessionhotspots,
    });

    const sessionAssistantsSnap = await courseRef.collection("members").where("role", "==", "session_assistant").get();
    const sessionAssistants = sessionAssistantsSnap.docs;

    const batch = db.batch();
    batch.delete(courseRef.collection("session").doc("live"));
    batch.delete(secretRef);
    batch.update(courseRef, { activeSession: null });
    sessionAssistants.forEach((d) => batch.update(d.ref, { role: "student" }));
    await batch.commit();

    if (sessionAssistants.length > 0) {
      const revokedMatrics = sessionAssistants.map((d) => String(d.data().matric || "").trim().toUpperCase());
      await courseRef.update({ assistants: FieldValue.arrayRemove(...revokedMatrics) });
    }

    return res.status(200).json({ success: true, sessionKey, attendeesCount: attendees.length, revokedSessionAssistants: sessionAssistants.length });
  } catch (error) {
    // 🔒 Generic message — error.message from Firestore embeds document paths.
    console.error("Close session error:", error);
    return res.status(500).json({ error: "Unable to close the session. Please try again." });
  }
}

async function handleRegisterDevice(req, res) {
  try {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) {
      try {
        const decoded = await getAuth().verifyIdToken(header.slice(7));
        const u = await db.collection("users").doc(decoded.uid).get();
        if (u.exists) {
          const m = String(u.data().matric || "").trim().toUpperCase();
          if (m) {
            await db.collection("devices").doc(`u_${decoded.uid}`).set({ uid: decoded.uid, matric: m, lastSeenAt: FieldValue.serverTimestamp() }, { merge: true });
          }
        }
      } catch (_) { }
    }

    const existing = readCookie(req.headers.cookie || "", "att_device");
    const deviceId = existing && /^[A-Za-z0-9_-]{8,}$/.test(existing) ? existing : "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

    res.setHeader("Set-Cookie", `att_device=${deviceId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`);
    return res.status(200).json({ deviceId });
  } catch (error) {
    console.error("Register device error:", error);
    return res.status(500).json({ error: "Could not register device." });
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    await verifyAppCheck(req);
    const action = req.query.action;
    if (action === "registerDevice") return handleRegisterDevice(req, res);
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAuth().verifyIdToken(header.slice(7));
    switch (action) {
      case "close": return handleClose(req, res, decoded);
      case "rotatePin": return handleRotatePin(req, res, decoded);
      case "startSession": return handleStartSession(req, res, decoded);
      default: return res.status(400).json({ error: "Invalid action. Use: close, registerDevice, rotatePin, startSession" });
    }
  } catch (error) {
    console.error("Session API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
