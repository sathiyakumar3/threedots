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

// ── Outlook Add-in: sign in and return a Firebase ID token ───────────────────
exports.addinLogin = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const apiKey = process.env.FIREBASE_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: 'Server configuration error.' });
    return;
  }

  try {
    const authRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      }
    );
    const authData = await authRes.json();
    if (!authRes.ok) {
      const msg = authData.error?.message || 'Invalid credentials.';
      res.status(401).json({ error: msg });
      return;
    }
    res.json({ token: authData.idToken });
  } catch (err) {
    console.error('addinLogin error:', err);
    res.status(500).json({ error: 'Authentication failed.' });
  }
});

// ── Outlook Add-in: return boards the user is a member of ────────────────────
exports.addinGetBoards = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const uid = await _verifyAddinToken(req);
  if (!uid) { res.status(401).json({ error: 'Unauthorised' }); return; }

  try {
    const snap = await admin.firestore().collection('boards')
      .where('users.members', 'array-contains', uid).get();
    const boards = snap.docs.map(d => ({ id: d.id, name: d.data().name || 'Untitled' }));
    res.json(boards);
  } catch (err) {
    console.error('addinGetBoards error:', err);
    res.status(500).json({ error: 'Failed to load boards.' });
  }
});

// ── Outlook Add-in: return columns for a board ───────────────────────────────
exports.addinGetColumns = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const uid = await _verifyAddinToken(req);
  if (!uid) { res.status(401).json({ error: 'Unauthorised' }); return; }

  const boardId = req.query.boardId;
  if (!boardId) { res.status(400).json({ error: 'boardId is required.' }); return; }

  try {
    const boardSnap = await admin.firestore().doc(`boards/${boardId}`).get();
    if (!boardSnap.exists) { res.status(404).json({ error: 'Board not found.' }); return; }

    const data    = boardSnap.data();
    const members = data?.users?.members || [];
    if (!members.includes(uid)) { res.status(403).json({ error: 'Access denied.' }); return; }

    const columns = (data.columns || []).map(c => ({ id: c.id, name: c.name || `Column ${c.id}` }));
    res.json(columns);
  } catch (err) {
    console.error('addinGetColumns error:', err);
    res.status(500).json({ error: 'Failed to load columns.' });
  }
});

// ── Outlook Add-in: create a card from an email ──────────────────────────────
exports.addinCreateCard = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const uid = await _verifyAddinToken(req);
  if (!uid) { res.status(401).json({ error: 'Unauthorised' }); return; }

  const { boardId, columnId, title, text } = req.body || {};
  if (!boardId || !title) { res.status(400).json({ error: 'boardId and title are required.' }); return; }

  try {
    // Verify membership before writing
    const boardSnap = await admin.firestore().doc(`boards/${boardId}`).get();
    if (!boardSnap.exists) { res.status(404).json({ error: 'Board not found.' }); return; }

    const members = boardSnap.data()?.users?.members || [];
    if (!members.includes(uid)) { res.status(403).json({ error: 'Access denied.' }); return; }

    const taskRef = admin.firestore().collection(`boards/${boardId}/tasks`).doc();
    const now     = new Date();
    await taskRef.set({
      id:        taskRef.id,
      title:     title.slice(0, 300),
      text:      (text || '').slice(0, 5000),
      tag:       'copyright',
      boardId,
      columnId:  parseInt(columnId, 10) || 0,
      order:     now.getTime(),
      created:   now.toISOString(),
      author:    uid,
      assignee:  '',
      priority:  '',
      startDate: '',
      deadline:  '',
      todos:     [],
      link:      '',
      comments:  0,
      attachments: 0,
      timeline: [{
        type:   'create',
        author: uid,
        text:   'created from Outlook',
        date:   now.toLocaleString()
      }]
    });

    res.json({ id: taskRef.id });
  } catch (err) {
    console.error('addinCreateCard error:', err);
    res.status(500).json({ error: 'Failed to create card.' });
  }
});

// ── Shared helper: verify Firebase ID token from Authorization header ─────────
async function _verifyAddinToken(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}
