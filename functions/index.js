const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * Triggered whenever a Firebase Auth user is deleted.
 * Cleans up all Firestore data associated with that user:
 *  - Removes the user from any boards they were a member/admin of
 *  - Recursively deletes boards where the user was the sole admin
 *  - Deletes the user's /users/{uid} profile document
 */
exports.onUserDeleted = functions.auth.user().onDelete(async (user) => {
  const db = admin.firestore();
  const uid = user.uid;

  // 1. Delete profile document (no-op if already removed by client)
  await db.doc(`users/${uid}`).delete().catch(() => {});

  // 2. Process all boards
  const boardsSnap = await db.collection('boards').get();
  const tasks = [];

  for (const boardDoc of boardsSnap.docs) {
    const data = boardDoc.data();
    const admins  = data?.users?.admins  || {};
    const members = data?.users?.members || {};
    const isAdmin  = Object.prototype.hasOwnProperty.call(admins,  uid);
    const isMember = Object.prototype.hasOwnProperty.call(members, uid);

    if (!isAdmin && !isMember) continue;

    const otherAdmins = Object.keys(admins).filter(id => id !== uid);

    if (isAdmin && otherAdmins.length === 0) {
      // Sole admin — recursively delete the entire board + subcollections
      tasks.push(db.recursiveDelete(boardDoc.ref));
    } else {
      // Just remove the user from the board
      const update = {};
      if (isAdmin)  update[`users.admins.${uid}`]  = admin.firestore.FieldValue.delete();
      if (isMember) update[`users.members.${uid}`] = admin.firestore.FieldValue.delete();
      tasks.push(boardDoc.ref.update(update));
    }
  }

  await Promise.all(tasks);
});
