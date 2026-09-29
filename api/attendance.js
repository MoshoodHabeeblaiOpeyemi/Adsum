const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");
const { ageMs, haversineMetres, isValidCoord } = require("../utils/geo");
const {
  recordFailure,
  recordSuccess,
  isBlocked,
} = require("../utils/throttle");

try {
  if (getApps().length === 0)
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(
          /\\n/g,
          "\n",
        ),
      }),
    });
} catch (e) {
  if (!/already exists/.test(e.message)) console.error("Init error:", e);
}

const db = getFirestore();
const norm = (v) =>
  String(v || "")
    .trim()
    .toUpperCase();

/** Coerce a possibly-string coordinate to a finite number, or null. */
const toNumberOrNull = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

async function handleSubmitAttendance(req, res, decoded) {
  try {
    const { courseId, pin, lat, lon, accuracy } = req.body || {};
    if (!courseId || !pin)
      return res.status(400).json({ error: "Course ID and PIN are required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists)
      return res.status(404).json({ error: "Course not found." });

    const memberRef = courseRef.collection("members").doc(decoded.uid);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists)
      return res
        .status(403)
        .json({ error: "You are not enrolled in this course." });

    const profile = await db.collection("users").doc(decoded.uid).get();
    const matric = norm(profile.data().matric);

    const liveRef = courseRef.collection("session").doc("live");
    const liveSnap = await liveRef.get();
    if (!liveSnap.exists)
      return res.status(403).json({ error: "No live session." });

    const live = liveSnap.data();
    const now = Date.now();
    if (!Number.isFinite(live.expiresAt) || now > live.expiresAt)
      return res.status(403).json({ error: "Session expired or invalid." });

    // 🛑 RATE LIMIT — checked BEFORE the PIN comparison so a locked-out caller
    // cannot keep probing. Keyed on uid+course, so a student on mobile data
    // after a Wi-Fi switch is unaffected.
    if (await isBlocked(decoded.uid, courseId)) {
      return res.status(429).json({
        error:
          "Too many incorrect PINs. Wait a moment and try the code currently on screen.",
        rateLimited: true,
      });
    }

    const secretSnap = await courseRef
      .collection("session")
      .doc("secret")
      .get();
    const secret = secretSnap.exists ? secretSnap.data() : {};

    // 🔒 PIN FRESHNESS AGAINST THE SERVER CLOCK.
    //
    // `pinRotationTime` may now be a Firestore Timestamp (server-authored) or a
    // plain number (written by the client before the migration). It must be
    // read with toMillis() — subtracting the Timestamp sentinel directly yields
    // NaN, and every comparison below then silently fails open.
    //
    // An UNREADABLE timestamp falls back to `Infinity`, so the PIN is treated as
    // expired rather than fresh. A missing or corrupt value must never be read
    // as "just rotated".
    const pinRotationIntervalMs = (live.pinRotationInterval || 10) * 1000;
    const pinAge = ageMs(secret.pinRotationTime, now, Infinity);

    // 🔒 SMALL CLOCK-SKEW GRACE. The rep's device and the server can disagree by
    // a second or two, and a legitimate student would otherwise be rejected for
    // a clock that is not theirs to fix. 2s of grace is far too small to be
    // useful to an attacker and large enough to absorb real drift.
    const SKEW_GRACE_MS = 2000;
    const isCurrentPinFresh =
      pinAge < pinRotationIntervalMs * 2 + SKEW_GRACE_MS;
    // The previous PIN keeps a longer window so a student who read the screen a
    // moment before it turned over is not punished.
    const isPreviousPinFresh =
      pinAge < pinRotationIntervalMs * 3 + SKEW_GRACE_MS;

    const submittedPin = String(pin).trim();
    // Constant-time compare: a timing side-channel on a 4-digit value is cheap
    // to measure and would let an attacker recover the PIN digit by digit.
    const pinMatches = (a, b) => {
      const x = String(a || "");
      const y = String(b || "");
      if (!x || !y || x.length !== y.length) return false;
      let diff = 0;
      for (let i = 0; i < x.length; i++)
        diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
      return diff === 0;
    };
    const isCurrentPinValid =
      pinMatches(submittedPin, secret.pin) && isCurrentPinFresh;
    const isPreviousPinValid =
      pinMatches(submittedPin, secret.previousPin) && isPreviousPinFresh;

    if (!isCurrentPinValid && !isPreviousPinValid) {
      // 🛑 Every miss is counted, server-side, in a transaction.
      const verdict = await recordFailure(
        decoded.uid,
        courseId,
        live.expiresAt,
      );
      if (verdict.blocked) {
        return res.status(429).json({
          error:
            "Too many incorrect PINs. Wait a moment and try the code currently on screen.",
          rateLimited: true,
          retryAfterSeconds: verdict.retryAfterSeconds,
        });
      }
      // Distinguish "right PIN, too late" from "wrong PIN" — the first is a
      // UX problem the student can fix by reading the screen again.
      if (pinMatches(submittedPin, secret.pin)) {
        return res.status(401).json({
          error:
            "PIN has expired. Use the latest PIN displayed on the projector/hotspot.",
          pinExpired: true,
        });
      }
      const left = Math.max(0, 5 - verdict.attempts);
      return res.status(401).json({
        error:
          left > 0
            ? `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left.`
            : "Incorrect PIN.",
        attemptsLeft: left,
      });
    }

    // 🌍 SERVER-SIDE GEOFENCE. The client gate is a convenience; this is the
    // control. A student can spoof GPS with a mock-location app or by calling
    // the API directly, and until now the server stored whatever coordinates it
    // was given without ever comparing them to the hall.
    if (live.locationMode !== "no_gps") {
      const hallLat = toNumberOrNull(secret.lat);
      const hallLon = toNumberOrNull(secret.lon);
      if (!isValidCoord(hallLat, hallLon)) {
        return res.status(503).json({
          error:
            "Location verification is unavailable for this session. Ask course staff to restart it.",
          locationUnavailable: true,
        });
      }
      if (!isValidCoord(lat, lon)) {
        await recordFailure(decoded.uid, courseId, live.expiresAt);
        return res.status(403).json({
          error:
            "Location is required for this session. Turn on location and try again.",
          needsLocation: true,
        });
      }
      const acc = toNumberOrNull(accuracy);
      if (acc === null || acc < 0 || acc > 500) {
        await recordFailure(decoded.uid, courseId, live.expiresAt);
        return res.status(403).json({
          error:
            "Your location is too imprecise. Move outdoors or near a window and try again.",
          needsBetterFix: true,
        });
      }
      const storedRadius = toNumberOrNull(secret.radius);
      const radius = storedRadius === null ? 80 : storedRadius;
      if (radius < 10 || radius > 500) {
        return res.status(503).json({
          error:
            "Location verification is unavailable for this session. Ask course staff to restart it.",
          locationUnavailable: true,
        });
      }
      const distance = haversineMetres(lat, lon, hallLat, hallLon);
      if (distance > radius) {
        await recordFailure(decoded.uid, courseId, live.expiresAt);
        return res.status(403).json({
          error: `You are ${Math.round(distance)}m from the hall. Move within ${radius}m and try again.`,
          distance: Math.round(distance),
          radius,
          outOfRange: true,
        });
      }
    }

    const secretRef = courseRef.collection("session").doc("secret");
    const checkinRef = courseRef
      .collection("checkins")
      .doc(`${decoded.uid}_${now}`);

    try {
      await db.runTransaction(async (tx) => {
        const secretSnap = await tx.get(secretRef);
        const secretData = secretSnap.exists ? secretSnap.data() : {};
        if ((secretData.attendees || []).includes(matric)) {
          throw new Error("ALREADY_CHECKED_IN");
        }
        // The rep is seeded into the secret doc at session creation — carry
        // them into the course-doc union so the student-facing feed converges
        // even if a publish/merge race dropped the rep's own entry.
        const managerMatric = secretData.managerMatric || "";
        // 📡 LIVE ATTENDEE PUBLISH — mirror the growing roster into the course
        // doc's activeSession too. Students cannot read the PIN-bearing
        // `session/secret` doc (staff-only), so without this their Live
        // Attendance roster stays frozen. Dotted-path updates fail on a null
        // `activeSession` (the <1s window between session creation and the
        // rep's publish) — so guard on a read INSIDE the same transaction;
        // if there's no map yet, the next check-in publishes everyone.
        const courseSnap = await tx.get(courseRef);
        const liveSession = courseSnap.exists
          ? courseSnap.data().activeSession
          : null;
        if (liveSession && typeof liveSession === "object") {
          // Union the checking-in student AND re-seed the rep (the course doc's
          // attendees can lose the rep through publish/merge races; students
          // can only see the course doc). arrayUnion dedupes, so this converges
          // even if the rep is already present.
          tx.update(courseRef, {
            "activeSession.attendees": managerMatric
              ? FieldValue.arrayUnion(matric, managerMatric)
              : FieldValue.arrayUnion(matric),
          });
        }
        tx.set(checkinRef, {
          uid: decoded.uid,
          matric,
          checkedInAt: FieldValue.serverTimestamp(),
          lat: lat || null,
          lon: lon || null,
          accuracy: accuracy || null,
        });
        tx.update(secretRef, { attendees: FieldValue.arrayUnion(matric) });
      });
    } catch (txError) {
      if (txError.message === "ALREADY_CHECKED_IN")
        return res
          .status(409)
          .json({ error: "You have already checked in for this session." });
      throw txError;
    }

    // A correct PIN clears the strike counter, so three honest typos do not
    // accumulate into a lockout for the rest of the session.
    await recordSuccess(decoded.uid, courseId);

    return res
      .status(200)
      .json({ success: true, message: "Checked in successfully!" });
  } catch (error) {
    // 🔒 Never return error.message. Firestore errors routinely embed collection
    // and document paths, which is a free schema map for an attacker. The full
    // error is logged server-side; the client gets a generic sentence.
    console.error("Submit attendance error:", error);
    return res
      .status(500)
      .json({ error: "Unable to submit attendance. Please try again." });
  }
}

async function handleFlagAbsent(req, res, decoded) {
  try {
    const { courseId, targetUid, reason } = req.body || {};
    if (!courseId || !targetUid)
      return res
        .status(400)
        .json({ error: "Course ID and target UID are required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists)
      return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const memberSnap = await courseRef
      .collection("members")
      .doc(decoded.uid)
      .get();
    const isRep = courseData.repUid === decoded.uid;
    const isAssistant =
      memberSnap.exists &&
      (memberSnap.data().role === "assistant" ||
        memberSnap.data().role === "session_assistant");
    if (!isRep && !isAssistant)
      return res
        .status(403)
        .json({ error: "Only course staff can flag absent." });
    if (targetUid === decoded.uid)
      return res
        .status(400)
        .json({ error: "You cannot flag yourself absent." });

    const liveRef = courseRef.collection("session").doc("live");
    const secretRef = courseRef.collection("session").doc("secret");
    const targetMemberRef = courseRef.collection("members").doc(targetUid);
    const flagRef = courseRef.collection("absentFlags").doc(targetUid);
    try {
      let normalizedTarget = "";
      await db.runTransaction(async (tx) => {
        const [liveSnap, secretSnap, targetMemberSnap, existing] =
          await Promise.all([
            tx.get(liveRef),
            tx.get(secretRef),
            tx.get(targetMemberRef),
            tx.get(flagRef),
          ]);
        if (!liveSnap.exists || !secretSnap.exists)
          throw new Error("NO_LIVE_SESSION");
        if (!targetMemberSnap.exists) throw new Error("STUDENT_NOT_FOUND");

        const live = liveSnap.data();
        if (!Number.isFinite(live.expiresAt) || Date.now() > live.expiresAt)
          throw new Error("NO_LIVE_SESSION");
        normalizedTarget = norm(targetMemberSnap.data().matric);
        const sessionExpiresAt = live.expiresAt;
        if ((secretSnap.data().attendees || []).includes(normalizedTarget))
          throw new Error("ALREADY_PRESENT");
        if (
          existing.exists &&
          existing.data().status === "flagged" &&
          existing.data().sessionExpiresAt === sessionExpiresAt
        )
          throw new Error("ALREADY_FLAGGED");

        tx.set(flagRef, {
          matric: normalizedTarget,
          status: "flagged",
          flaggedBy: decoded.uid,
          flaggedAt: FieldValue.serverTimestamp(),
          reason: typeof reason === "string" ? reason.slice(0, 200) : "",
          sessionExpiresAt,
        });
      });
      return res.status(200).json({
        success: true,
        message: `${normalizedTarget} flagged as absent.`,
      });
    } catch (error) {
      if (error.message === "NO_LIVE_SESSION")
        return res.status(403).json({ error: "No active session." });
      if (error.message === "STUDENT_NOT_FOUND")
        return res
          .status(404)
          .json({ error: "Student not found in this course." });
      if (error.message === "ALREADY_PRESENT")
        return res.status(409).json({
          error:
            "This student has already checked in and cannot be flagged absent.",
        });
      if (error.message === "ALREADY_FLAGGED")
        return res.status(409).json({ error: "Student already flagged." });
      throw error;
    }
  } catch (error) {
    // 🔒 Generic message — see handleSubmitAttendance.
    console.error("Flag absent error:", error);
    return res
      .status(500)
      .json({ error: "Unable to flag the student. Please try again." });
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    await verifyAppCheck(req);
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAuth().verifyIdToken(header.slice(7));
    const action = req.query.action;
    switch (action) {
      case "submit":
        return handleSubmitAttendance(req, res, decoded);
      case "flagAbsent":
        return handleFlagAbsent(req, res, decoded);
      default:
        return res
          .status(400)
          .json({ error: "Invalid action. Use: submit, flagAbsent" });
    }
  } catch (error) {
    console.error("Attendance API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
