const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");
const requireVerifiedEmail = require("../utils/requireVerifiedEmail");

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
// Firestore doc IDs cannot contain "/", but matric numbers often do (24/56SV002) — that crashed enroll with "Expected documentPath".
// Registry keys percent-encode illegal/ambiguous chars; "%" is encoded FIRST so the mapping stays reversible (no collisions).
const escKeyPart = (v) =>
  String(v || "")
    .trim()
    .toUpperCase()
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/\|/g, "%7C");
const registryDocId = (institution, matric) =>
  `${escKeyPart(institution) || "UNKNOWN"}|${escKeyPart(matric)}`;
const USER_SUBCOLLECTIONS = ["fcmTokens", "notifications"];
const REP_CHANGE_LIMIT = 50;

async function delSub(ref) {
  let snap = await ref.limit(500).get(),
    total = 0;
  while (!snap.empty) {
    const b = db.batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
    total += snap.size;
    snap = await ref.limit(500).get();
  }
  return total;
}

async function deleteQueryDocs(query) {
  const snap = await query.get();
  for (let offset = 0; offset < snap.docs.length; offset += 450) {
    const batch = db.batch();
    snap.docs
      .slice(offset, offset + 450)
      .forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  return snap.size;
}

function redactRepChanges(changes, uid, matric) {
  return (Array.isArray(changes) ? changes : [])
    .slice(-REP_CHANGE_LIMIT)
    .map((change) => {
      const redacted = { ...change };
      if (redacted.by === uid) redacted.by = "deleted_account";
      if (matric && norm(redacted.matric) === matric) redacted.name = null;
      if (matric && norm(redacted.previousMatric) === matric)
        redacted.previousName = null;
      return redacted;
    });
}

async function handleDeleteAccount(req, res, decoded) {
  try {
    const uid = decoded.uid;
    const profileRef = db.collection("users").doc(uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists)
      return res.status(404).json({ error: "Profile not found." });
    const profile = profileSnap.data();
    const matric = norm(profile.matric);
    const institution = norm(profile.institution) || "UNKNOWN";

    let memberships;
    try {
      memberships = await db
        .collectionGroup("members")
        .where("uid", "==", uid)
        .get();
    } catch (queryErr) {
      const code = queryErr && queryErr.code;
      if (
        code === 9 ||
        /FAILED_PRECONDITION|requires an index/i.test(
          String(queryErr && queryErr.message),
        )
      ) {
        console.error(
          "deleteAccount: members collection-group index missing",
          queryErr.message,
        );
        return res.status(503).json({
          error:
            "Account deletion is temporarily unavailable. Please try again shortly.",
          code: "INDEX_NOT_DEPLOYED",
        });
      }
      throw queryErr;
    }

    const ownedCourses = await db
      .collection("courses")
      .where("repUid", "==", uid)
      .get();
    const courseIds = new Set();
    memberships.docs.forEach((doc) => courseIds.add(doc.ref.parent.parent.id));
    ownedCourses.docs.forEach((doc) => courseIds.add(doc.id));
    let coursesLeft = 0;
    let coursesArchived = 0;

    for (const courseId of courseIds) {
      const courseRef = db.collection("courses").doc(courseId);
      const memberRef = courseRef.collection("members").doc(uid);
      const liveRef = courseRef.collection("session").doc("live");
      const secretRef = courseRef.collection("session").doc("secret");
      const manualRef = courseRef.collection("manualRequests").doc(uid);
      const archived = await db.runTransaction(async (tx) => {
        const [course, member, live, secret, manual] = await Promise.all([
          tx.get(courseRef),
          tx.get(memberRef),
          tx.get(liveRef),
          tx.get(secretRef),
          tx.get(manualRef),
        ]);
        if (!course.exists) return false;

        const isCurrentRep = course.data().repUid === uid;
        const courseMatric = norm(
          (member.exists && member.data().matric) || matric,
        );
        const courseUpdates = {
          enrolled: FieldValue.arrayRemove(courseMatric),
          assistants: FieldValue.arrayRemove(courseMatric),
        };
        if (isCurrentRep) {
          Object.assign(courseUpdates, {
            repUid: null,
            rep: "Former course rep",
            assistants: [],
            activeSession: null,
            archived: true,
            archivedAt: FieldValue.serverTimestamp(),
            archivedReason: "rep_account_deleted",
          });
          if (live.exists) tx.delete(liveRef);
          if (secret.exists) tx.delete(secretRef);
        }
        tx.update(courseRef, courseUpdates);
        if (member.exists) tx.delete(memberRef);
        if (manual.exists) {
          if (manual.data().status === "pending") tx.delete(manualRef);
          else
            tx.update(manualRef, {
              uid: "deleted_account",
              name: "Deleted account",
              reason: null,
            });
        }
        return isCurrentRep;
      });

      if (archived) {
        const remainingStaff = await courseRef
          .collection("members")
          .where("role", "in", ["assistant", "session_assistant", "rep"])
          .get();
        for (
          let offset = 0;
          offset < remainingStaff.docs.length;
          offset += 450
        ) {
          const batch = db.batch();
          remainingStaff.docs.slice(offset, offset + 450).forEach((member) => {
            batch.update(member.ref, { role: "student" });
          });
          await batch.commit();
        }
        coursesArchived++;
      } else coursesLeft++;
    }

    if (matric) {
      const regRef = db
        .collection("matricRegistry")
        .doc(registryDocId(institution, matric));
      const regSnap = await regRef.get();
      if (regSnap.exists && regSnap.data().uid === uid) await regRef.delete();
    }

    const [repSlots, adviserSlots, adviserRosters, repRosters, matricRosters] =
      await Promise.all([
        db.collection("departmentReps").where("repUid", "==", uid).get(),
        db.collection("adviserSlots").where("adviserUid", "==", uid).get(),
        db.collection("departmentRosters").where("adviserUid", "==", uid).get(),
        db
          .collection("departmentRosters")
          .where("chosenRepUid", "==", uid)
          .get(),
        matric
          ? db
              .collection("departmentRosters")
              .where("matrics", "array-contains", matric)
              .get()
          : Promise.resolve({ docs: [] }),
      ]);

    const affectedRosters = new Map();
    for (const snap of [adviserRosters, repRosters, matricRosters]) {
      for (const doc of snap.docs) affectedRosters.set(doc.id, doc);
    }
    for (const rosterDoc of affectedRosters.values()) {
      const roster = rosterDoc.data();
      const updates = {
        repChanges: redactRepChanges(roster.repChanges, uid, matric),
      };
      if (roster.adviserUid === uid) updates.adviserUid = null;
      if (matric && norm(roster.institution) === institution) {
        updates.students = (
          Array.isArray(roster.students) ? roster.students : []
        ).map((student) =>
          norm(student.matric) === matric ? { ...student, name: "" } : student,
        );
      }
      if (roster.chosenRepUid === uid) {
        updates.chosenRepMatric = null;
        updates.chosenRepUid = null;
        updates.chosenRepName = null;
        updates.chosenRepAt = null;
        const changes = updates.repChanges;
        changes.push({
          action: "rep_account_deleted",
          previousMatric: roster.chosenRepMatric || matric || null,
          previousName: null,
          matric: roster.chosenRepMatric || matric || null,
          name: null,
          at: new Date(),
          by: "deleted_account",
        });
        updates.repChanges = changes.slice(-REP_CHANGE_LIMIT);
      }
      await rosterDoc.ref.update(updates);
    }

    for (const slot of [...repSlots.docs, ...adviserSlots.docs]) {
      if (slot.data().repUid === uid || slot.data().adviserUid === uid) {
        await slot.ref.delete();
      }
    }

    await deleteQueryDocs(db.collection("pinAttempts").where("uid", "==", uid));
    await db
      .collection("devices")
      .doc(`u_${uid}`)
      .delete()
      .catch(() => {});
    await Promise.all(
      USER_SUBCOLLECTIONS.map((name) => delSub(profileRef.collection(name))),
    );
    await Promise.all([
      db
        .collection("emailVerifications")
        .doc(uid)
        .delete()
        .catch(() => {}),
      db
        .collection("adviserVerifications")
        .doc(uid)
        .delete()
        .catch(() => {}),
    ]);
    await profileRef.delete();
    try {
      await getAuth().deleteUser(uid);
    } catch (error) {
      if (error.code !== "auth/user-not-found") {
        console.error(
          "deleteAccount: Auth user cleanup failed",
          uid,
          error.message,
        );
      }
    }
    return res.status(200).json({
      success: true,
      coursesLeft,
      coursesArchived,
      historyPreserved: true,
    });
  } catch (error) {
    console.error("Delete account error:", error);
    return res
      .status(500)
      .json({ error: "Unable to delete your account. Please try again." });
  }
}

async function handleClaimMatric(req, res, decoded) {
  try {
    if (
      String(process.env.REQUIRE_EMAIL_VERIFIED || "").toLowerCase() ===
        "true" &&
      !decoded.email_verified
    )
      return res.status(403).json({
        error: "Please verify your email first.",
        emailNotVerified: true,
      });
    const profile = await db.collection("users").doc(decoded.uid).get();
    if (!profile.exists || !profile.data().matric)
      return res.status(400).json({ error: "Profile with matric required." });
    const matric = norm(profile.data().matric),
      institution = norm(profile.data().institution) || "UNKNOWN";
    const regRef = db
      .collection("matricRegistry")
      .doc(registryDocId(institution, matric));
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(regRef);
        if (snap.exists && snap.data().uid !== decoded.uid)
          throw new Error("MATRIC_CLAIMED_BY_ANOTHER");
        tx.set(
          regRef,
          {
            uid: decoded.uid,
            matric,
            institution,
            department: norm(profile.data().department) || null,
            level: norm(profile.data().level) || null,
            claimedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
    } catch (txError) {
      if (txError.message === "MATRIC_CLAIMED_BY_ANOTHER")
        return res.status(409).json({
          error: `Matric ${matric} already claimed.`,
          matricClaimed: true,
        });
      throw txError;
    }
    return res
      .status(200)
      .json({ success: true, message: `Matric ${matric} secured.` });
  } catch (error) {
    console.error("Claim matric error:", error);
    return res.status(500).json({
      error: "Unable to secure that matric number. Please try again.",
    });
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
      case "deleteAccount":
        return handleDeleteAccount(req, res, decoded);
      case "claimMatric":
        if (!requireVerifiedEmail(decoded, res)) return;
        return handleClaimMatric(req, res, decoded);
      default:
        return res
          .status(400)
          .json({ error: "Invalid action. Use: deleteAccount, claimMatric" });
    }
  } catch (error) {
    console.error("Account API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
