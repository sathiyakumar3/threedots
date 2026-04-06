// ── _uidMap sessionStorage helpers ──────────────────────────────────────────
let _uidCacheKey = '';
function _uidMapInit(uid) {
  _uidCacheKey = `uidmap_${uid}`;
  try {
    const stored = sessionStorage.getItem(_uidCacheKey);
    if (stored) window._uidMap = JSON.parse(stored);
  } catch (_) {}
  window._uidMap = window._uidMap || {};
}
function _uidMapSet(uid, data) {
  window._uidMap = window._uidMap || {};
  window._uidMap[uid] = data;
  if (!_uidCacheKey) return;
  try { sessionStorage.setItem(_uidCacheKey, JSON.stringify(window._uidMap)); } catch (_) {}
}

// ── Mutual-exclusion: only one popup/dropdown open at a time ───────────────
window.closeAllPopups = function(skip = []) {
  const all = [
    { id: 'boardDropdown',        cls: 'open', extra: null },
    { id: 'boardComboMenu',       cls: 'open', extra: 'boardComboTrigger' },
    { id: 'tagsPopup',            cls: 'open', extra: 'tagsBtn' },
    { id: 'tplPopup',             cls: 'open', extra: 'tplBtn' },
    { id: 'densityPicker',        cls: 'open', extra: null },
    { id: 'teamPanel',            cls: 'open', extra: null },
    { id: 'topbarUser',           cls: 'open', extra: null },
  ];
  all.forEach(({ id, cls, extra }) => {
    if (skip.includes(id)) return;
    document.getElementById(id)?.classList.remove(cls);
    if (extra) document.getElementById(extra)?.classList.remove(cls);
  });
};

function sendInvitationEmail({ email, boardName, invitedByName, inviteLink }) {
  const cfg = window.EMAILJS_CONFIG;
  if (!cfg?.serviceId || cfg.serviceId === 'YOUR_SERVICE_ID') {
    console.warn('EmailJS not configured — invitation stored in Firestore but email not sent.');
    showToast('Invite saved — email delivery requires EmailJS setup', true);
    return;
  }
  if (typeof emailjs === 'undefined') {
    console.warn('EmailJS library not loaded.');
    return;
  }
  emailjs.send(cfg.serviceId, cfg.templateId,
    { to_email: email, board_name: boardName, invited_by: invitedByName, invite_link: inviteLink },
    cfg.publicKey
  ).catch(err => console.error('EmailJS send error:', err));
}

document.addEventListener('DOMContentLoaded', () => {

  // ── Auth: gate the whole app behind Google sign-in ──────────────────────
  const loginOverlay  = document.getElementById('loginOverlay');
  const appShell      = document.getElementById('appShell');
  const btnGoogle     = document.getElementById('btnGoogleSignIn');
  const loginError    = document.getElementById('loginError');
  const verifyBanner  = document.getElementById('verifyBanner');

  // Auto-focus email input when login overlay is visible
  setTimeout(() => { document.getElementById('loginEmail')?.focus(); }, 80);

  // ── Progressive email disclosure ──
  document.getElementById('toggleEmailForm').addEventListener('click', () => {
    const section = document.getElementById('loginEmailSection');
    const btn     = document.getElementById('toggleEmailForm');
    const isOpen  = section.classList.contains('open');
    section.classList.toggle('open', !isOpen);
    btn.classList.toggle('open', !isOpen);
    if (!isOpen) setTimeout(() => document.getElementById('loginEmail')?.focus(), 320);
  });

  function setLoginError(msg)   { loginError.textContent = msg; loginError.classList.remove('login-success-msg'); }
  function setLoginSuccess(msg)  { loginError.textContent = msg; loginError.classList.add('login-success-msg'); }
  function clearLoginError()     { loginError.textContent = ''; loginError.classList.remove('login-success-msg'); }

  function friendlyAuthError(code) {
    const map = {
      'auth/user-not-found':             'No account found with that email.',
      'auth/wrong-password':             'Incorrect password. Try again.',
      'auth/invalid-credential':         'Incorrect email or password.',
      'auth/invalid-login-credentials':  'Incorrect email or password.',
      'auth/email-already-in-use':    'An account with this email already exists.',
      'auth/weak-password':           'Password must be at least 6 characters.',
      'auth/invalid-email':           'Please enter a valid email address.',
      'auth/too-many-requests':       'Too many attempts. Please try again later.',
      'auth/network-request-failed':  'Network error. Check your connection.',
      'auth/popup-blocked':           'Popup was blocked. Please allow popups for this site and try again.',
      'auth/popup-closed-by-user':    '',
      'auth/cancelled-popup-request': '',
      'auth/operation-not-allowed':   'This sign-in method is not enabled. Contact support.',
      'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
      'auth/user-disabled':           'This account has been disabled.',
      'auth/internal-error':          'An internal error occurred. Please try again.',
    };
    return map[code] ?? null;
  }

  function setAuthLoading(btn, loading) {
    btn.disabled = loading;
    if (loading) {
      btn.dataset.origHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
    } else {
      btn.innerHTML = btn.dataset.origHtml || btn.innerHTML;
      delete btn.dataset.origHtml;
    }
  }

  // ── Show / hide app ──
  function showApp(user) {
    currentUser = user;
    // Restore _uidMap from sessionStorage for this user (avoids repeat reads)
    _uidMapInit(user.uid);
    // Read user doc first to get favourite, then merge-update lastLogin
    db.collection('users').doc(user.uid).get()
      .then(userSnap => {
        userFavouriteBoard = userSnap.exists ? (userSnap.data().favourite || null) : null;
        const savedView = userSnap.exists ? (userSnap.data().viewPreference || null) : null;
        if (savedView && window.applyView) window.applyView(savedView, false);
        db.collection('users').doc(user.uid).set({
          uid:         user.uid,
          displayName: user.displayName || '',
          email:       user.email       || '',
          photoURL:    user.photoURL    || '',
          lastLogin:   firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.error('Error saving user:', err));

        // Convert any pending invitations for this user's email to full membership
        const conversionPromise = user.email
          ? db.collection('invitations')
              .where('email', '==', user.email.toLowerCase())
              .where('status', '==', 'pending')
              .get()
              .then(invSnap => {
                if (invSnap.empty) return;
                const batch = db.batch();
                invSnap.docs.forEach(invDoc => {
                  const inv = invDoc.data();
                  batch.update(db.doc(`boards/${inv.boardId}`), {
                    'users.members':    firebase.firestore.FieldValue.arrayUnion(user.uid),
                    'users.nonMembers': firebase.firestore.FieldValue.arrayRemove(inv.email)
                  });
                  batch.update(invDoc.ref, {
                    status: 'accepted',
                    acceptedAt:    firebase.firestore.FieldValue.serverTimestamp(),
                    acceptedByUid: user.uid
                  });
                });
                return batch.commit();
              })
              .catch(err => console.error('Invitation conversion error:', err))
          : Promise.resolve();

        conversionPromise.finally(() => {
          if (window._loadUserTags) window._loadUserTags(user.uid);
          loadUserBoards(user.uid);
        });
      })
      .catch(() => {
        userFavouriteBoard = null;
        if (window._loadUserTags) window._loadUserTags(user.uid);
        loadUserBoards(user.uid);
      });
    document.getElementById('navUserName').textContent  = user.displayName || user.email;
    document.getElementById('navUserEmail').textContent = user.email;
    // Seed photo map with the logged-in user
    // Seed UID map with logged-in user
    _uidMapSet(user.uid, { name: user.displayName || user.email || '', photo: user.photoURL || '', email: user.email || '' });
    if (user.displayName && user.photoURL) {
      window._userPhotoMap = window._userPhotoMap || {};
      window._userPhotoMap[user.displayName] = user.photoURL;
    }
    const avatarEl = document.getElementById('navAvatar');
    const avatarDropEl = document.getElementById('navAvatarDrop');
    if (user.photoURL) {
      const safePhoto = safeUrl(user.photoURL);
      if (safePhoto) {
        avatarEl.innerHTML = `<img src='${safePhoto}' alt='avatar'>`;
        if (avatarDropEl) avatarDropEl.innerHTML = `<img src='${safePhoto}' alt='avatar'>`;
      } else {
        const initial = (user.displayName || user.email || '?')[0].toUpperCase();
        avatarEl.textContent = initial;
        if (avatarDropEl) avatarDropEl.textContent = initial;
      }
    } else {
      const initial = (user.displayName || user.email || '?')[0].toUpperCase();
      avatarEl.textContent = initial;
      if (avatarDropEl) avatarDropEl.textContent = initial;
    }
    loginOverlay.classList.add('hidden');
    appShell.style.display = '';
  }

  function loadUserBoards(uid) {
    board.innerHTML = '';
    document.getElementById('boardComboList').innerHTML = '';
    document.getElementById('boardComboLabel').textContent = 'Select board';
    // Query boards where user is an admin OR a member (two queries merged)
    Promise.all([
      db.collection('boards').where('users.admins',  'array-contains', uid).get(),
      db.collection('boards').where('users.members', 'array-contains', uid).get()
    ]).then(([adminSnap, memberSnap]) => {
      const seen = new Set();
      const allDocs = [];
      [...adminSnap.docs, ...memberSnap.docs].forEach(d => {
        if (!seen.has(d.id)) { seen.add(d.id); allDocs.push(d); }
      });
      return { empty: allDocs.length === 0, docs: allDocs };
    }).then(snapshot => {
        if (snapshot.empty) {
          Swal.fire({
            title: 'Welcome! 👋',
            html: `It seems you're just getting started — let's create your first board!`,
            icon: 'info',
            input: 'text',
            inputLabel: 'Board name',
            inputPlaceholder: 'e.g. My First Board',
            inputValue: 'My First Board',
            confirmButtonText: 'Create Board',
            confirmButtonColor: 'var(--purple)',
            showCancelButton: false,
            allowOutsideClick: false,
            inputValidator: val => !val.trim() && 'Please enter a board name.'
          }).then(result => {
            if (!result.isConfirmed) return;
            createBoard(result.value.trim());
          });
          return;
        }
        const docs = snapshot.docs.sort((a, b) => {
          if (a.id === 'main') return -1;
          if (b.id === 'main') return  1;
          const na = (a.data().name || '').toLowerCase();
          const nb = (b.data().name || '').toLowerCase();
          return na.localeCompare(nb);
        });
        docs.forEach(doc => addBoardSelectOption(doc.id, doc.data().name || doc.id));
        const ids      = docs.map(d => d.id);
        const targetId = (userFavouriteBoard && ids.includes(userFavouriteBoard))
          ? userFavouriteBoard
          : ids.includes('main') ? 'main' : docs[0].id;
        loadBoard(targetId);
      })
      .catch(err => {
        console.error('Could not load boards:', err);
        board.insertAdjacentHTML('beforebegin',
          `<p style="color:#e05252;padding:.5rem 1rem;font-size:13px">⚠ Could not connect to Firestore.</p>`);
      });
  }

  function hideApp() {
    currentUser = null;
    if (_tasksUnsub) { _tasksUnsub(); _tasksUnsub = null; }
    window._localWriteIds = new Set();
    BOARD_ID = 'main';
    board.innerHTML = '';
    document.getElementById('boardComboList').innerHTML = '';
    document.getElementById('boardComboLabel').textContent = 'Select board';
    document.querySelectorAll('.participant-avatar').forEach(el => el.remove());
    appShell.style.display = 'none';
    loginOverlay.classList.remove('hidden');
  }

  window.saveViewPreference = function(view) {
    if (!currentUser) return;
    db.collection('users').doc(currentUser.uid)
      .set({ viewPreference: view }, { merge: true })
      .catch(err => console.error('Error saving view preference:', err));
  };

  appShell.style.display = 'none';
  auth.onAuthStateChanged(user => {
    if (user) {
      const isEmailPassword = user.providerData.some(p => p.providerId === 'password');
      if (isEmailPassword && !user.emailVerified) {
        // Email/password account that hasn't verified yet — keep on login screen
        verifyBanner.style.display = '';
        auth.signOut();
        return;
      }
      verifyBanner.style.display = 'none';
      showApp(user);
    } else {
      hideApp();
    }
  });

  // ── Google sign-in ──
  btnGoogle.addEventListener('click', () => {
    clearLoginError();
    btnGoogle.classList.add('btn-social--loading');
    auth.signInWithPopup(googleProvider)
      .catch(err => {
        console.error('Google sign-in error:', err.code, err.message);
        const msg = friendlyAuthError(err.code);
        if (msg !== null) { if (msg) setLoginError(msg); }
        else setLoginError(err.message);
      })
      .finally(() => btnGoogle.classList.remove('btn-social--loading'));
  });

  // ── Microsoft sign-in ──
  document.getElementById('btnMicrosoftSignIn').addEventListener('click', () => {
    clearLoginError();
    const btn = document.getElementById('btnMicrosoftSignIn');
    btn.classList.add('btn-social--loading');
    auth.signInWithPopup(microsoftProvider)
      .catch(err => {
        console.error('Microsoft sign-in error:', err.code, err.message);
        const msg = friendlyAuthError(err.code);
        if (msg !== null) { if (msg) setLoginError(msg); }
        else setLoginError(err.message);
      })
      .finally(() => btn.classList.remove('btn-social--loading'));
  });

  // ── Email / password sign-in ──
  document.getElementById('btnEmailSignIn').addEventListener('click', () => {
    clearLoginError();
    const btn      = document.getElementById('btnEmailSignIn');
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { setLoginError('Please enter your email and password.'); return; }
    setAuthLoading(btn, true);
    auth.signInWithEmailAndPassword(email, password)
      .then(cred => {
        if (!cred.user.emailVerified) {
          setLoginError('Please verify your email first — check your inbox for the verification link.');
          verifyBanner.style.display = '';
          return auth.signOut();
        }
      })
      .catch(err => {
        const msg = friendlyAuthError(err.code);
        setLoginError(msg !== null ? msg : 'Sign-in failed. Please try again.');
      })
      .finally(() => setAuthLoading(btn, false));
  });
  document.getElementById('loginFormEl').addEventListener('submit', () =>
    document.getElementById('btnEmailSignIn').click()
  );

  // ── Email / password register ──
  document.getElementById('btnRegister').addEventListener('click', () => {
    clearLoginError();
    const btn      = document.getElementById('btnRegister');
    const email    = document.getElementById('regEmail').value.trim();
    const name     = document.getElementById('regDisplayName').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm  = document.getElementById('regPasswordConfirm').value;
    if (!email || !password) { setLoginError('Please fill in all fields.'); return; }
    if (password.length < 6) { setLoginError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setLoginError('Passwords do not match.'); return; }
    setAuthLoading(btn, true);
    auth.createUserWithEmailAndPassword(email, password)
      .then(cred => {
        const tasks = [];
        if (name) tasks.push(cred.user.updateProfile({ displayName: name }));
        tasks.push(cred.user.sendEmailVerification());
        return Promise.all(tasks).then(() => cred.user.reload());
      })
      .then(() => {
        // Show verification banner instead of letting user in
        verifyBanner.style.display = '';
        document.getElementById('registerForm').style.display = 'none';
        clearLoginError();
      })
      .catch(err => {
        const msg = friendlyAuthError(err.code);
        setLoginError(msg !== null ? msg : 'Registration failed. Please try again.');
      })
      .finally(() => setAuthLoading(btn, false));
  });
  document.getElementById('registerFormEl').addEventListener('submit', () =>
    document.getElementById('btnRegister').click()
  );

  // ── Resend verification email ──
  document.getElementById('resendVerification').addEventListener('click', () => {
    const user = auth.currentUser;
    if (!user) return;
    user.sendEmailVerification()
      .then(() => setLoginSuccess('Verification email resent — check your inbox.'))
      .catch(() => setLoginError('Could not resend. Please try again shortly.'));
  });

  // ── Toggle sign-in ↔ register ──
  document.getElementById('showRegister').addEventListener('click', () => {
    document.getElementById('loginForm').style.display    = 'none';
    document.getElementById('registerForm').style.display = '';
    clearLoginError();
  });
  document.getElementById('showLogin').addEventListener('click', () => {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display    = '';
    clearLoginError();
  });

  // ── Forgot password ──
  document.getElementById('showForgotPassword').addEventListener('click', () => {
    const email = document.getElementById('loginEmail').value.trim();
    if (!email) { setLoginError('Enter your email address first, then click Forgot password.'); return; }
    const btn = document.getElementById('showForgotPassword');
    clearLoginError();
    btn.disabled = true;
    btn.textContent = 'Sending…';
    auth.sendPasswordResetEmail(email)
      .then(() => setLoginSuccess('Reset email sent — check your inbox.'))
      .catch(err => {
        const msg = friendlyAuthError(err.code);
        setLoginError(msg !== null ? msg : 'Could not send reset email. Please try again.');
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = 'Forgot password?';
      });
  });

  // ── Show / hide password toggle ──
  document.getElementById('loginOverlay').addEventListener('click', e => {
    const toggleBtn = e.target.closest('.login-pwd-toggle');
    if (!toggleBtn) return;
    const input = document.getElementById(toggleBtn.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggleBtn.querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
  });

  // ── Password strength indicator ──
  document.getElementById('regPassword').addEventListener('input', () => {
    const val  = document.getElementById('regPassword').value;
    const wrap = document.getElementById('pwdStrength');
    const lbl  = document.getElementById('pwdStrengthLabel');
    if (!val) { wrap.className = 'pwd-strength'; lbl.textContent = ''; return; }
    const isStrong = val.length >= 10 && /[A-Z]/.test(val) && /[0-9]/.test(val) && /[^A-Za-z0-9]/.test(val);
    const isFair   = val.length >= 8  && (/[A-Z]/.test(val) || /[0-9]/.test(val));
    if (isStrong)    { wrap.className = 'pwd-strength pwd-strength--strong'; lbl.textContent = 'Strong'; }
    else if (isFair) { wrap.className = 'pwd-strength pwd-strength--fair';   lbl.textContent = 'Fair'; }
    else             { wrap.className = 'pwd-strength pwd-strength--weak';   lbl.textContent = 'Weak'; }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    document.getElementById('topbarUser')?.classList.remove('open');
    auth.signOut();
  });

  // ── Delete account ───────────────────────────────────────────────────────
  document.getElementById('deleteAccountBtn').addEventListener('click', () => {
    document.getElementById('topbarUser')?.classList.remove('open');
    Swal.fire({
      title: 'Delete your account?',
      html: 'This will permanently delete your account and all boards you own. This <strong>cannot be undone</strong>.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete my account',
      confirmButtonColor: '#e05252',
      cancelButtonText: 'Cancel',
      reverseButtons: true
    }).then(async result => {
      if (!result.isConfirmed) return;

      const user = auth.currentUser;
      if (!user) return;
      const uid = user.uid;

      // Best-effort client-side cleanup before deleting the auth account:
      // boards where the user is the sole admin are deleted; otherwise the
      // user is just removed from the member/admin maps.  The Cloud Function
      // (functions/index.js) handles any cleanup that survives a disconnection.
      try {
        const boardsSnap = await db.collection('boards').get();
        const batch = db.batch();
        let batchCount = 0;
        const boardsToDelete = [];

        for (const boardDoc of boardsSnap.docs) {
          const data = boardDoc.data();
          const admins  = data?.users?.admins  || {};
          const members = data?.users?.members || {};
          const isAdmin  = Object.prototype.hasOwnProperty.call(admins,  uid);
          const isMember = Object.prototype.hasOwnProperty.call(members, uid);
          if (!isAdmin && !isMember) continue;

          const otherAdmins = Object.keys(admins).filter(id => id !== uid);
          if (isAdmin && otherAdmins.length === 0) {
            // Sole admin — queue for full deletion (subcollections cleaned by Cloud Function)
            boardsToDelete.push(boardDoc.ref);
          } else {
            // Remove the user from admin/member maps
            const update = {};
            if (isAdmin)  update[`users.admins.${uid}`]  = firebase.firestore.FieldValue.delete();
            if (isMember) update[`users.members.${uid}`] = firebase.firestore.FieldValue.delete();
            batch.update(boardDoc.ref, update);
            batchCount++;
            if (batchCount >= 400) { await batch.commit(); batchCount = 0; }
          }
        }

        for (const ref of boardsToDelete) {
          batch.delete(ref);
          batchCount++;
          if (batchCount >= 400) { await batch.commit(); batchCount = 0; }
        }

        if (batchCount > 0) await batch.commit();

        // Delete user profile document
        await db.doc(`users/${uid}`).delete().catch(() => {});

      } catch (err) {
        console.warn('Pre-delete cleanup error (non-fatal):', err);
      }

      // Delete the Firebase Auth account
      user.delete()
        .then(() => { /* Cloud Function handles remaining cleanup */ })
        .catch(err => {
          if (err.code === 'auth/requires-recent-login') {
            Swal.fire({
              title: 'Re-authentication required',
              text: 'For security, please sign out and sign back in, then try again.',
              icon: 'info',
              confirmButtonText: 'OK'
            });
          } else {
            Swal.fire({ title: 'Error', text: err.message, icon: 'error' });
          }
        });
    });
  });

  // ── Search ───────────────────────────────────────────────────────────────
  const boardSearch   = document.getElementById('boardSearch');
  const searchClear   = document.getElementById('searchClear');
  const searchToggle  = document.getElementById('searchToggle');
  const topbarSearch  = document.getElementById('topbarSearch');

  let _searchTimer;
  function applySearch(query) {
    const q = query.trim().toLowerCase();
    board.querySelectorAll('.task').forEach(card => {
      if (card.closest('.project-column--trash')) {
        card.classList.remove('task--search-hidden', 'task--search-match');
        return;
      }
      if (!q) {
        card.classList.remove('task--search-hidden', 'task--search-match');
      } else {
        const haystack = card.dataset.search || '';
        const match = haystack.includes(q);
        card.classList.toggle('task--search-hidden', !match);
        card.classList.toggle('task--search-match',   match);
      }
    });
    searchClear.classList.toggle('visible', q.length > 0);
  }

  function openSearch() {
    topbarSearch.classList.add('open');
    // Wait for transition then focus
    setTimeout(() => boardSearch.focus(), 50);
  }
  function closeSearch() {
    boardSearch.value = '';
    applySearch('');
    topbarSearch.classList.remove('open');
  }

  searchToggle.addEventListener('click', e => {
    e.stopPropagation();
    topbarSearch.classList.contains('open') ? closeSearch() : openSearch();
  });

  boardSearch.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => applySearch(boardSearch.value), 150);
  });
  boardSearch.addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });

  searchClear.addEventListener('click', () => {
    boardSearch.value = '';
    applySearch('');
    boardSearch.focus();
  });

  document.addEventListener('click', e => {
    if (!topbarSearch.contains(e.target) && !boardSearch.value.trim()) {
      topbarSearch.classList.remove('open');
    }
  });

  // ── Activity panel toggle ────────────────────────────────────────────────
  const activityPanel  = document.getElementById('activityPanel');
  const activityToggle = document.getElementById('activityToggle');
  function openActivityPanel()  { activityPanel.classList.remove('collapsed'); activityToggle.classList.add('active');    activityToggle.title = 'Hide activity'; }
  function closeActivityPanel() { activityPanel.classList.add('collapsed');    activityToggle.classList.remove('active'); activityToggle.title = 'Show activity'; }
  activityToggle.addEventListener('click', () => {
    document.getElementById('boardDropdown')?.classList.remove('open');
    activityPanel.classList.contains('collapsed') ? openActivityPanel() : closeActivityPanel();
  });
  document.getElementById('activityPanelClose')?.addEventListener('click', () => closeActivityPanel());

  // ── Clear activity logs ──────────────────────────────────────────────────
  document.getElementById('activityClearBtn').addEventListener('click', () => {
    if (!BOARD_ID) return;
    Swal.fire({
      title: 'Clear all activity logs?',
      text: 'This will permanently delete all activity entries for this board.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, clear all',
      confirmButtonColor: '#e05252',
      cancelButtonText: 'Cancel',
      reverseButtons: true
    }).then(result => {
      if (!result.isConfirmed) return;
      const btn = document.getElementById('activityClearBtn');
      btn.innerHTML = '<i class="fas fa-spinner"></i> Clearing…';
      btn.disabled = true;
      db.collection(`boards/${BOARD_ID}/activity`)
        .get()
        .then(snap => {
          const batch = db.batch();
          snap.forEach(doc => batch.delete(doc.ref));
          return batch.commit();
        })
        .then(() => {
          document.getElementById('activityFeed').innerHTML = '';
          btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear logs';
          btn.disabled = false;
          showToast('Activity logs cleared');
        })
        .catch(err => {
          console.error('Clear activity error:', err);
          btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear logs';
          btn.disabled = false;
          showToast('Could not clear logs', true);
        });
    });
  });

  // ── Activity period filter ───────────────────────────────────────────────
  let _activityPeriod = 'today';
  let _activityCustomRange = null; // { from: Date, to: Date }
  let _activityCalendar = null;

  function filterActivityFeed() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // Sunday-based week start (Sun=0 … Sat=6)
    const weekStart  = todayStart - (now.getDay() * 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    let visibleCount = 0;
    feed.querySelectorAll('li[data-ts]').forEach(li => {
      const ts = parseInt(li.dataset.ts);
      let visible = true;
      if (_activityPeriod === 'today')       visible = ts >= todayStart;
      else if (_activityPeriod === 'week')   visible = ts >= weekStart;
      else if (_activityPeriod === 'month')  visible = ts >= monthStart;
      else if (_activityPeriod === 'custom') {
        visible = _activityCustomRange
          ? ts >= _activityCustomRange.from && ts <= _activityCustomRange.to
          : false;
      }
      // 'all' → always visible
      li.style.display = visible ? '' : 'none';
      if (visible) visibleCount++;
    });

    // Empty state
    let emptyEl = feed.querySelector('.activity-empty');
    if (visibleCount === 0) {
      if (!emptyEl) {
        emptyEl = document.createElement('li');
        emptyEl.className = 'activity-empty';
        feed.appendChild(emptyEl);
      }
      const labels = { today:'today', week:'this week', month:'this month', custom:'the selected range', all:'' };
      emptyEl.textContent = `No activity${labels[_activityPeriod] ? ' ' + labels[_activityPeriod] : ''}.`;
      emptyEl.style.display = '';
    } else if (emptyEl) {
      emptyEl.style.display = 'none';
    }
  }

  // Expose so logActivity can re-filter after each new entry
  window._filterActivityFeed = filterActivityFeed;

  const periodTabs = document.getElementById('activityPeriodTabs');
  const calWrap    = document.getElementById('activityCalendarWrap');

  function openCalPopover() {
    calWrap.style.display = '';
    if (!_activityCalendar && window.VanillaCalendarPro) {
      const { Calendar } = window.VanillaCalendarPro;
      _activityCalendar = new Calendar('#activityCalendar', {
        selectionDatesMode: 'multiple-ranged',
        selectedTheme: 'light',
        onClickDate(self) {
          const dates = self.context.selectedDates;
          if (dates.length >= 2) {
            const sorted = [...dates].sort();
            _activityCustomRange = {
              from: new Date(sorted[0] + 'T00:00:00').getTime(),
              to:   new Date(sorted[sorted.length - 1] + 'T00:00:00').setHours(23, 59, 59, 999),
            };
            closeCalPopover();
            filterActivityFeed();
          }
        },
      });
      _activityCalendar.init();
    }
  }

  function closeCalPopover() {
    calWrap.style.display = 'none';
  }

  // Close popover when clicking outside
  document.addEventListener('click', e => {
    if (calWrap.style.display === 'none') return;
    if (calWrap.contains(e.target)) return;
    if (e.target.closest('#customPeriodTab')) return;
    // Clicked outside — revert to 'all' if no range was picked
    if (!_activityCustomRange) {
      _activityPeriod = 'all';
      periodTabs.querySelectorAll('.activity-period-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.period === 'all')
      );
      filterActivityFeed();
    }
    closeCalPopover();
  }, true);

  if (periodTabs) {
    periodTabs.addEventListener('click', e => {
      const btn = e.target.closest('.activity-period-tab');
      if (!btn) return;
      periodTabs.querySelectorAll('.activity-period-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activityPeriod = btn.dataset.period;

      if (_activityPeriod === 'custom') {
        _activityCustomRange = null;
        openCalPopover();
      } else {
        closeCalPopover();
        filterActivityFeed();
      }
    });
  }

  // Filter on initial load
  filterActivityFeed();

  // ── Dark / light mode toggle ─────────────────────────────────────────────
  const themeBtn = document.getElementById('themeToggleBtn');
  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    const icon  = document.getElementById('themeToggleIcon')  || themeBtn.querySelector('i');
    const label = document.getElementById('themeToggleLabel');
    if (icon)  { icon.className = dark ? 'fas fa-sun' : 'fas fa-moon'; }
    if (label) { label.textContent = dark ? 'Light mode' : 'Dark mode'; }
    themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    themeBtn.classList.toggle('active', dark);
    if (window.Coloris) Coloris({ themeMode: dark ? 'dark' : 'light' });
  }
  applyTheme(localStorage.getItem('theme') === 'dark');
  themeBtn.addEventListener('click', () => {
    const isDark = !document.body.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    applyTheme(isDark);
  });

  // ── Fullscreen toggle ─────────────────────────────────────────────────────
  const fullscreenBtn   = document.getElementById('fullscreenBtn');
  const fullscreenIcon  = document.getElementById('fullscreenIcon');
  const fullscreenLabel = document.getElementById('fullscreenLabel');
  function updateFullscreenBtn() {
    const isFs = !!document.fullscreenElement;
    fullscreenIcon.className  = isFs ? 'fas fa-compress' : 'fas fa-expand';
    fullscreenLabel.textContent = isFs ? 'Exit full screen' : 'Full screen';
  }
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
    document.getElementById('topbarUser').classList.remove('open');
  });
  document.addEventListener('fullscreenchange', updateFullscreenBtn);
  updateFullscreenBtn();

  const board   = document.querySelector('.project-tasks');
  let userFavouriteBoard = null;
  let _tasksUnsub = null; // active tasks onSnapshot unsubscribe handle

  // ── Column task-count badge helpers ─────────────────────────────────────
  function refreshColCount(colEl) {
    const isTrashCol = colEl.classList.contains('project-column--trash');
    const count = colEl.querySelectorAll(':scope > .task').length;
    const badge = colEl.querySelector('.col-count');
    if (!badge) return;
    if (isTrashCol) { badge.textContent = count; badge.removeAttribute('title'); return; }
    const limit = colEl.dataset.wipLimit ? +colEl.dataset.wipLimit : 0;
    const isSpecial = colEl.classList.contains('project-column--archive') || colEl.classList.contains('project-column--trash');
    if (!isSpecial) colEl.classList.toggle('project-column--empty', count === 0);
    if (limit > 0) {
      badge.textContent = `${count}/${limit}`;
      badge.title = count > limit
        ? `⚠ Over WIP limit! ${count} of ${limit} allowed`
        : count === limit
          ? `At WIP limit (${limit})`
          : `WIP limit: ${limit}`;
      badge.classList.toggle('wip-over', count > limit);
      badge.classList.toggle('wip-near', count === limit);
    } else {
      badge.textContent = count;
      badge.removeAttribute('title');
      badge.classList.remove('wip-over', 'wip-near');
    }
  }
  function refreshAllColCounts() {
    document.querySelectorAll('.project-column').forEach(refreshColCount);
  }
  // Auto-refresh: only react to .task cards being added/removed inside columns
  new MutationObserver(mutations => {
    if (mutations.some(m => [...m.addedNodes, ...m.removedNodes].some(n => n.classList?.contains('task')))) {
      refreshAllColCounts();
      scheduleOverflowCheck();
    }
  }).observe(board, { childList: true, subtree: true });

  // Re-check overflow when the window is resized
  window.addEventListener('resize', () => {
    // Clamp any fixed colWidths that now exceed the available board width
    const boardEl = document.querySelector('.project-tasks');
    if (boardEl) {
      const maxW = boardEl.clientWidth;
      boardEl.querySelectorAll('.project-column[data-col-width]').forEach(col => {
        if (+col.dataset.colWidth > maxW) delete col.dataset.colWidth;
      });
    }
    scheduleOverflowCheck();
  });

  // ── Author identity helpers ──────────────────────────────────────────────
  function _authorName()  { const n = currentUser?.displayName || currentUser?.email || 'You'; return n.split(' ')[0]; }

  // ── Inject a single timeline entry into an existing card ────────────────
  function _addCardTlEntry(card, type, text) {
    const uid    = currentUser?.uid || '';
    const name   = _authorName();
    const photo  = _authorPhoto();
    const now    = Date.now();
    const date   = fmtDate(now);
    const avatar = photo
      ? `<img class='tl-avatar' src='${photo}' alt='${name}' title='${name}'>`
      : `<span class='tl-avatar tl-avatar--initial' title='${name}'>${name[0].toUpperCase()}</span>`;
    const textDiv  = `<div class="task__tl-text">${text}<div class="task__tl-meta"><time>${date}</time><b>${name}</b></div></div>`;
    const entryHTML = `<div class="task__tl-entry" data-ts="${now}" data-author-uid="${uid}"><span class="task__tl-dot task__tl-dot--${type}">${avatar}</span>${textDiv}</div>`;
    const tl = card.querySelector('.task__timeline');
    if (tl) {
      tl.insertAdjacentHTML('beforeend', entryHTML);
    } else {
      const footer = card.querySelector('.task__footer');
      if (footer) footer.insertAdjacentHTML('beforebegin', `<div class="task__timeline">${entryHTML}</div>`);
    }
  }
  function _authorPhoto() { return currentUser?.photoURL    || ''; }
  function _authorAvatar() {
    const name  = _authorName();
    const photo = _authorPhoto();
    const safeName = escapeHTML(name);
    return photo
      ? `<img class='tl-avatar' src='${photo}' alt='${safeName}' title='${safeName}'>`
      : `<span class='tl-avatar tl-avatar--initial' title='${safeName}'>${escapeHTML(name[0].toUpperCase())}</span>`;
  }

  // ── Board nav helpers ────────────────────────────────────────────────────
  function addBoardSelectOption(id, name) {
    const menu = document.getElementById('boardComboList');
    const btn  = document.createElement('button');
    btn.className      = 'board-combo__item';
    btn.dataset.boardId = id;
    btn.textContent    = name;
    btn.addEventListener('click', () => {
      loadBoard(id);
      document.getElementById('boardComboMenu').classList.remove('open');
      document.getElementById('boardComboTrigger').classList.remove('open');
    });
    menu.appendChild(btn);
    return btn;
  }

  // ── Load a board by Firestore doc ID ────────────────────────────────────
  let _currentLoadId = 0; // incremented on every loadBoard call to discard stale responses
  function loadBoard(id) {
    // Tear down any previous tasks listener before switching boards
    if (_tasksUnsub) { _tasksUnsub(); _tasksUnsub = null; }
    const _loadId = ++_currentLoadId; // capture for stale-response guard
    window._localWriteIds = new Set();
    BOARD_ID = id;
    board.innerHTML = '';
    // Clear any collapsed columns carried over from the previous board
    const _csl = document.getElementById('collapsedBar');
    if (_csl) _csl.innerHTML = '';
    document.getElementById('activityFeed').innerHTML = '';
    // ── Set up Firestore activity persistence hook ──
    window._persistActivity = (type, text, date, ts) => {
      db.collection(`boards/${BOARD_ID}/activity`)
        .add({ type, text, date, ts })
        .catch(err => console.error('Activity persist error:', err));
    };
    const srch = document.getElementById('boardSearch');
    if (srch) { srch.value = ''; searchClear.classList.remove('visible'); }
    // Reset filters when switching boards
    if (window._resetBoardFilters) window._resetBoardFilters();
    // Highlight active item in combo
    document.getElementById('boardComboMenu').querySelectorAll('.board-combo__item')
      .forEach(b => b.classList.toggle('active', b.dataset.boardId === id));
    // Reset archive button + show-archive state
    board.classList.add('show-archive');
    document.getElementById('archiveBtn')?.classList.add('active');
    // Reset trash button + show-trash state
    board.classList.add('show-trash');
    document.getElementById('trashBtn')?.classList.add('active');
    // Close board options dropdown if open
    document.getElementById('boardDropdown').classList.remove('open');
    // Reset activity panel to collapsed
    const actPanel = document.getElementById('activityPanel');
    const actToggle = document.getElementById('activityToggle');
    if (actPanel)  actPanel.classList.add('collapsed');
    if (actToggle) { actToggle.classList.remove('active'); actToggle.title = 'Show activity'; }

    db.doc(`boards/${id}`).get()
      .then(snap => {
        if (_loadId !== _currentLoadId) return; // stale response – a newer loadBoard fired
        if (snap.exists) {
          const data = snap.data();
          const name = data.name || 'Board';
          const menu = document.getElementById('boardComboMenu');
          const item = menu.querySelector(`[data-board-id="${id}"]`);
          if (item) { item.textContent = name; }
          document.getElementById('boardComboLabel').textContent = name;
          if (data.tags && window._applyBoardTags) window._applyBoardTags(data.tags);
          if (window._applyBoardBackground) window._applyBoardBackground(data.background || null);
          setTimeout(() => window._updateIconContrast?.(), 200);
          const _adminUids  = data.users?.admins  || (data.admins ? data.admins : (data.owner ? [data.owner] : []));
          const _memberUids = data.users?.members || [];
          const _boardUsers = [...new Set([..._adminUids, ..._memberUids])];
          // Set current user's role for this board
          window._boardRole    = _adminUids.includes(currentUser?.uid) ? 'admin' : 'member';
          window._primaryAdmin = _adminUids[0] || null;
          window._pendingEmails = data.users?.nonMembers || [];
          const _appShell = document.getElementById('appShell');
          _appShell.dataset.role      = window._boardRole;
          _appShell.dataset.isPrimary = (currentUser?.uid === window._primaryAdmin) ? 'true' : 'false';
          // Prefetch all board member profiles into _uidMap before rendering cards
          const _uidsNeeded = _boardUsers.filter(uid => !(window._uidMap && window._uidMap[uid]));
          Promise.all(_uidsNeeded.map(uid =>
            db.collection('users').doc(uid).get().then(s => ({ uid, s })).catch(() => null)
          )).then(results => {
            window._uidMap = window._uidMap || {};
            results.forEach(r => {
              if (!r || !r.s || !r.s.exists) return;
              const u = r.s.data();
              _uidMapSet(r.uid, { name: u.displayName || u.email || 'User', photo: u.photoURL || '', email: u.email || '' });
            });
            if (data.columns) {
              buildColumnsFromData(data.columns);
              // Show archive and trash by default
              board.classList.add('show-archive', 'show-trash');
              document.getElementById('archiveBtn')?.classList.add('active');
              document.getElementById('trashBtn')?.classList.add('active');
              syncGrid();
              // ── Migration: add Trash column to boards that pre-date the feature ──
              if (!board.querySelector('.project-column--trash')) {
                const trashDiv = document.createElement('div');
                trashDiv.className = 'project-column project-column--trash';
                trashDiv.dataset.columnId = '100';
                trashDiv.dataset.colOrder  = '998';
                trashDiv.innerHTML = `<div class='project-column-heading'>
                  <h2 class='project-column-heading__title'>Trash</h2>
                  <span class='col-count'>0</span>
                  <button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button>
                </div>`;
                board.appendChild(trashDiv);
                setupColDropdown(trashDiv);
                syncGrid();
                saveChanges(true);
              }
              // ── Migration: add Archive column to boards that pre-date the feature ──
              if (!board.querySelector('.project-column--archive')) {
                const archiveDiv = document.createElement('div');
                archiveDiv.className = 'project-column project-column--archive';
                archiveDiv.dataset.columnId = '99';
                archiveDiv.dataset.colOrder  = '997';
                archiveDiv.innerHTML = `<div class='project-column-heading'>
                  <h2 class='project-column-heading__title'>Archive</h2>
                  <span class='col-count'>0</span>
                  <button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button>
                </div>`;
                board.appendChild(archiveDiv);
                setupColDropdown(archiveDiv);
                syncGrid();
                saveChanges(true);
              }
              // ── Real-time tasks listener ──────────────────────────────
              // Restore columns that were explicitly saved as collapsed by the user
              requestAnimationFrame(() => {
                board.querySelectorAll('.project-column[data-restore-collapsed]').forEach(col => {
                  delete col.dataset.restoreCollapsed;
                  toggleColCollapse(col, true); // skipSave: data already correct in Firestore
                });
              });

              let _tasksInitialised = false;
              window._boardLayoutReady = false;
              _tasksUnsub = db.collection(`boards/${id}/tasks`)
                .onSnapshot(snap => {
                  if (!_tasksInitialised) {
                    // ── Initial load: same sorted batch render as before ──
                    _tasksInitialised = true;
                    if (!snap.empty) {
                      const tasks = snap.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .sort((a, b) => (a.order || 0) - (b.order || 0));
                      buildTasksFromFlatData(tasks);
                      // ── Auto-purge trash cards older than 30 days ──
                      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
                      const now = Date.now();
                      const trashCol = document.querySelector('.project-column--trash');
                      if (trashCol) {
                        let purged = 0;
                        [...trashCol.querySelectorAll(':scope > .task')].forEach(card => {
                          const deletedAt = +card.dataset.deletedAt;
                          if (deletedAt && (now - deletedAt) >= THIRTY_DAYS) {
                            const tid = card.dataset.id;
                            card.remove();
                            if (tid) db.collection(`boards/${BOARD_ID}/tasks`).doc(tid).delete().catch(() => {});
                            purged++;
                          }
                        });
                        if (purged > 0) {
                            logActivity('delete', `<b>System</b> auto-purged ${purged} card${purged !== 1 ? 's' : ''} from Trash (30-day limit)`);
                            saveChanges(true);
                          }
                      }
                    } else if (Array.isArray(data.tasks) && data.tasks.length > 0) {
                      // Migration: tasks stored in top-level collection
                      Promise.all(data.tasks.map(tid => db.collection('tasks').doc(tid).get()))
                        .then(snaps => {
                          const tasks = snaps
                            .filter(s => s.exists)
                            .map(s => s.data())
                            .sort((a, b) => (a.order || 0) - (b.order || 0));
                          buildTasksFromFlatData(tasks);
                        })
                        .catch(err => console.error('Could not migrate tasks:', err));
                    } else if (data.tasks && !Array.isArray(data.tasks)) {
                      buildTasksFromData(data.tasks);
                    }
                    // Mark layout ready after columns + tasks have settled
                    setTimeout(() => { window._boardLayoutReady = true; }, 800);
                    return;
                  }

                  // ── Incremental updates from other users ───────────────
                  snap.docChanges().forEach(change => {
                    const taskData = change.doc.data();
                    const taskId   = change.doc.id || taskData.id;

                    if (change.type === 'removed') {
                      const cardEl = document.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`);
                      if (cardEl) { cardEl.remove(); refreshAllColCounts(); scheduleOverflowCheck(); }
                      return;
                    }

                    // Skip echoes of our own writes
                    if (window._localWriteIds?.has(taskId)) return;

                    if (change.type === 'added') {
                      // Only add if not already in DOM (search board + sidebars for collapsed cols)
                      if (document.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`)) return;
                      const colEl = document.querySelector(`.project-column[data-column-id="${taskData.columnId}"]`)
                                 || board.querySelector('.project-column');
                      if (colEl) {
                        colEl.appendChild(renderCard({ id: taskId, ...taskData }));
                        refreshAllColCounts();
                        scheduleOverflowCheck();
                      }
                      return;
                    }

                    if (change.type === 'modified') {
                      const existing = document.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`);
                      const newCard  = renderCard({ id: taskId, ...taskData });
                      // Preserve expanded state
                      if (existing?.classList.contains('task--expanded')) newCard.classList.add('task--expanded');
                      // Check if the card moved to a different column (search board + sidebars)
                      const targetCol = document.querySelector(`.project-column[data-column-id="${taskData.columnId}"]`);
                      if (existing) {
                        if (targetCol && existing.closest('.project-column') !== targetCol) {
                          targetCol.appendChild(newCard);
                          existing.remove();
                        } else {
                          existing.replaceWith(newCard);
                        }
                      } else if (targetCol) {
                        targetCol.appendChild(newCard);
                      }
                      refreshAllColCounts();
                      scheduleOverflowCheck();
                    }
                  });
                }, err => console.error('Tasks listener error:', err));
            }
            renderParticipants(_adminUids, _boardUsers);
            // Refresh filter assignee list after board loads
            setTimeout(() => { if (window._refreshFilterAssignees) window._refreshFilterAssignees(); }, 500);
            // ── Load persisted activity feed from subcollection ──
            db.collection(`boards/${id}/activity`)
              .orderBy('ts', 'desc')
              .limit(200)
              .get()
              .then(snap => {
                snap.docs.map(d => d.data()).reverse().forEach(a => {
                  logActivity(a.type, a.text, a.date, a.ts, true /* skipPersist */);
                });
              })
              .catch(err => console.error('Activity load error:', err));
          });
          // sync favourite star + dropdown button
          const isFav = userFavouriteBoard === id;
          const favStar = document.getElementById('boardFavStar');
          if (favStar) favStar.classList.toggle('visible', isFav);
          const favBtn = document.getElementById('boardOptFavourite');
          const favLbl = document.getElementById('boardOptFavouriteLabel');
          if (favLbl) favLbl.textContent = isFav ? 'Remove favourite' : 'Make favourite';
          favBtn?.classList.toggle('fav-active', isFav);
        }
      })
      .catch(err => {
        console.error('Could not load board:', err);
        board.insertAdjacentHTML('beforebegin',
          `<p style="color:#e05252;padding:.5rem 1rem;font-size:13px">⚠ Could not connect to Firestore.</p>`);
      });
  }

  // ── Participants avatars ─────────────────────────────────────────────────────
  function renderParticipants(adminUids, allUids) {
    const container = document.getElementById('projectParticipants');
    container.querySelectorAll('.participant-avatar, .participants-sep').forEach(el => el.remove());
    return; // avatars hidden — only the team button is shown
    const addBtn = document.getElementById('addParticipantBtn');

    const makeAvatar = (uid, isAdmin) => {
      const cached = (window._uidMap && window._uidMap[uid]) || {};
      const name   = cached.name  || uid;
      const photo  = cached.photo || '';
      const av     = document.createElement('div');
      av.className = 'participant-avatar' + (isAdmin ? ' participant-avatar--admin' : '');
      av.dataset.uid = uid;
      const inner = photo
        ? `<img src='${photo}' alt='${escapeHTML(name)}'>`
        : `<span>${escapeHTML(name[0].toUpperCase())}</span>`;
      const crown = isAdmin ? `<span class='pa-crown'><i class='fas fa-crown'></i></span>` : '';
      const roleClass = isAdmin ? 'pcard__title--admin' : 'pcard__title--member';
      const roleLabel = isAdmin ? '<i class="fas fa-shield-alt"></i> Admin' : '<i class="fas fa-user"></i> Member';
      av.innerHTML = `${inner}${crown}
        <div class='participant-card'>
          <div class='pcard__title ${roleClass}'>${roleLabel}</div>
          <div class='pcard__info'>
            <div class='pcard__row'><div class='pcard__name'>${escapeHTML(name)}</div></div>
            <div class='pcard__row'><div class='pcard__email'>${escapeHTML(cached.email || '')}</div></div>
          </div>
        </div>`;
      return av;
    };

    const memberUids = allUids.filter(uid => !adminUids.includes(uid));

    // Fetch any profiles not yet in _uidMap
    const unknown = allUids.filter(uid => !(window._uidMap && window._uidMap[uid]));
    Promise.all(unknown.map(uid =>
      db.collection('users').doc(uid).get().catch(() => null)
    )).then(snaps => {
      window._uidMap = window._uidMap || {};
      snaps.forEach(s => {
        if (!s || !s.exists) return;
        const u = s.data();
        _uidMapSet(s.id, { name: u.displayName || u.email || 'User', photo: u.photoURL || '', email: u.email || '' });
      });
      adminUids.forEach(uid  => container.insertBefore(makeAvatar(uid, true),  addBtn));
      if (adminUids.length && memberUids.length) {
        const sep = document.createElement('div');
        sep.className = 'participants-sep';
        container.insertBefore(sep, addBtn);
      }
      memberUids.forEach(uid => container.insertBefore(makeAvatar(uid, false), addBtn));
      if (typeof refreshAllAssigneeAvatars === 'function') refreshAllAssigneeAvatars();
    });
  }

  // Toggle participant mini-card on click, close on outside click
  document.getElementById('projectParticipants').addEventListener('click', e => {
    const av = e.target.closest('.participant-avatar');
    if (!av) return;
    e.stopPropagation();
    const isOpen = av.classList.contains('open');
    document.querySelectorAll('.participant-avatar.open').forEach(el => el.classList.remove('open'));
    if (!isOpen) av.classList.add('open');
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.participant-avatar.open').forEach(el => el.classList.remove('open'));
  });

  // ── Team management panel ─────────────────────────────────────────────────
  const addParticipantBtn = document.getElementById('addParticipantBtn');
  const teamPanel         = document.getElementById('teamPanel');
  const participantEmail  = document.getElementById('participantEmail');
  const participantMsg    = document.getElementById('participantMsg');
  const participantAddConfirm = document.getElementById('participantAddConfirm');
  let _teamPanelData = { admins: [], members: [], nonMembers: [] };

  function openTeamPanel() {
    closeAllPopups(['teamPanel']);
    participantEmail.value = '';
    participantMsg.textContent = '';
    participantMsg.className = 'team-panel__msg';
    teamPanel.classList.add('open');
    // Load and render team from Firestore
    db.doc(`boards/${BOARD_ID}`).get().then(snap => {
      if (!snap.exists) return;
      const bd         = snap.data();
      const admins     = bd.users?.admins     || (bd.admins ? bd.admins : (bd.owner ? [bd.owner] : []));
      const members    = bd.users?.members    || [];
      const nonMembers = bd.users?.nonMembers || [];
      const allUids = [...new Set([...admins, ...members])];
      const unknown = allUids.filter(uid => !(window._uidMap && window._uidMap[uid]));
      Promise.all(unknown.map(uid =>
        db.collection('users').doc(uid).get().catch(() => null)
      )).then(snaps => {
        window._uidMap = window._uidMap || {};
        snaps.forEach(s => {
          if (!s || !s.exists) return;
          const u = s.data();
          _uidMapSet(s.id, { name: u.displayName || u.email || 'User', photo: u.photoURL || '', email: u.email || '' });
        });
        renderTeamPanel(admins, members, nonMembers);
        document.getElementById('teamPanelCount').textContent = allUids.length + nonMembers.length;
      });
    });
    participantEmail.focus();
  }

  function closeTeamPanel() {
    teamPanel.classList.remove('open');
  }

  function renderTeamPanel(admins, members, nonMembers = [], filter = '') {
    _teamPanelData = { admins, members, nonMembers };
    const body = document.getElementById('teamPanelBody');
    const q    = filter.toLowerCase();

    const buildRow = (uid, isAdmin, adminCount) => {
      const info  = window._uidMap?.[uid] || {};
      const name  = info.name  || uid;
      const email = info.email || '';
      const photo = info.photo || '';
      if (q && !name.toLowerCase().includes(q) && !email.toLowerCase().includes(q)) return '';
      const avatarHTML = photo
        ? `<img src='${photo}' alt='${name}'>`
        : name[0].toUpperCase();
      const isCurrentUser   = uid === currentUser?.uid;
      const viewerIsAdmin   = window._boardRole === 'admin';
      const isPrimaryAdmin  = uid === admins[0];
      const ownerBadge = isPrimaryAdmin
        ? `<span class='tmr-owner-badge'><i class='fas fa-crown'></i> Owner</span>`
        : '';
      let actions = '';

      if (viewerIsAdmin && !isPrimaryAdmin) {
        if (isAdmin) {
          if (adminCount > 1 && !isCurrentUser) {
            actions = `<button class='tmr-demote' data-uid='${uid}'>Demote</button>`;
          }
        } else {
          actions = `<button class='tmr-promote' data-uid='${uid}'>Make Admin</button>
                     <button class='tmr-remove'  data-uid='${uid}'><i class='fas fa-times'></i></button>`;
        }
      }
      return `<div class='team-member-row${isPrimaryAdmin ? ' team-member-row--owner' : ''}' data-uid='${uid}'>
        <div class='team-member-row__avatar'>${avatarHTML}</div>
        <div class='team-member-row__info'>
          <div class='team-member-row__name'>${name}${ownerBadge}</div>
          <div class='team-member-row__email'>${email}</div>
        </div>
        <div class='team-member-row__actions'>${actions}</div>
      </div>`;
    };

    const buildPendingRow = (email) => {
      if (q && !email.toLowerCase().includes(q)) return '';
      const viewerIsAdmin = window._boardRole === 'admin';
      const actions = viewerIsAdmin
        ? `<button class='tmr-revoke' data-email='${email}' title='Revoke invitation'><i class='fas fa-times'></i></button>`
        : '';
      return `<div class='team-member-row team-member-row--pending'>
        <div class='team-member-row__avatar team-member-row__avatar--pending'><i class='fas fa-envelope'></i></div>
        <div class='team-member-row__info'>
          <div class='team-member-row__name'>${email}</div>
          <div class='team-member-row__email'>Invitation pending</div>
        </div>
        <div class='team-member-row__actions'>${actions}</div>
      </div>`;
    };

    const adminRows   = admins.map(uid   => buildRow(uid, true,  admins.length)).filter(Boolean);
    const memberRows  = members.map(uid  => buildRow(uid, false, admins.length)).filter(Boolean);
    const pendingRows = nonMembers.map(e => buildPendingRow(e)).filter(Boolean);

    if (!adminRows.length && !memberRows.length && !pendingRows.length) {
      body.innerHTML = `<div class='team-panel__empty'>No members found.</div>`;
      return;
    }

    body.innerHTML = [
      adminRows.length   ? `<div class='team-section__hdr team-section__hdr--admin'><i class='fas fa-shield-alt'></i> Admins</div>${adminRows.join('')}` : '',
      memberRows.length  ? `<div class='team-section__hdr team-section__hdr--member'><i class='fas fa-user'></i> Members</div>${memberRows.join('')}` : '',
      pendingRows.length ? `<div class='team-section__hdr team-section__hdr--pending'><i class='fas fa-clock'></i> Pending</div>${pendingRows.join('')}` : ''
    ].join('');
  }

  addParticipantBtn.addEventListener('click', e => {
    e.stopPropagation();
    teamPanel.classList.contains('open') ? closeTeamPanel() : openTeamPanel();
  });
  document.getElementById('teamPanelClose').addEventListener('click', closeTeamPanel);

  document.addEventListener('click', e => {
    if (!teamPanel.contains(e.target) && e.target !== addParticipantBtn) closeTeamPanel();
  });

  document.getElementById('teamSearch').addEventListener('input', e => {
    renderTeamPanel(_teamPanelData.admins, _teamPanelData.members, _teamPanelData.nonMembers, e.target.value.trim());
  });

  // Promote / demote / remove via panel
  document.getElementById('teamPanelBody').addEventListener('click', e => {
    const promoteBtn = e.target.closest('.tmr-promote');
    const demoteBtn  = e.target.closest('.tmr-demote');
    const removeBtn  = e.target.closest('.tmr-remove');
    const revokeBtn  = e.target.closest('.tmr-revoke');

    if (revokeBtn) {
      const invEmail = revokeBtn.dataset.email;
      db.doc(`boards/${BOARD_ID}`).get().then(snap => {
        if (!snap.exists) return;
        const bd         = snap.data();
        const admins     = bd.users?.admins     || [];
        const members    = bd.users?.members    || [];
        const nonMembers = (bd.users?.nonMembers || []).filter(e => e !== invEmail);
        // Mark any matching invitations as revoked, then update board
        db.collection('invitations')
          .where('boardId', '==', BOARD_ID)
          .where('email',   '==', invEmail)
          .where('status',  '==', 'pending')
          .get()
          .then(invSnap => {
            const batch = db.batch();
            batch.update(db.doc(`boards/${BOARD_ID}`), { 'users.nonMembers': nonMembers });
            invSnap.docs.forEach(d => batch.update(d.ref, { status: 'revoked' }));
            return batch.commit();
          })
          .then(() => {
            window._pendingEmails = nonMembers;
            renderTeamPanel(admins, members, nonMembers, document.getElementById('teamSearch').value.trim());
            document.getElementById('teamPanelCount').textContent = admins.length + members.length + nonMembers.length;
            logActivity('participant', `<b>${_authorName()}</b> revoked invitation for <b>${invEmail}</b>`);
          });
      });
      return;
    }

    if (promoteBtn) {
      const uid = promoteBtn.dataset.uid;
      db.doc(`boards/${BOARD_ID}`).get().then(snap => {
        if (!snap.exists) return;
        const bd      = snap.data();
        const admins  = bd.users?.admins  || [];
        const members = (bd.users?.members || []).filter(u => u !== uid);
        const newAdmins = [...admins, uid];
        db.doc(`boards/${BOARD_ID}`).update({ 'users.admins': newAdmins, 'users.members': members })
          .then(() => {
            renderParticipants(newAdmins, [...newAdmins, ...members]);
            renderTeamPanel(newAdmins, members, bd.users?.nonMembers || [], document.getElementById('teamSearch').value.trim());
            document.getElementById('teamPanelCount').textContent = newAdmins.length + members.length + (bd.users?.nonMembers?.length || 0);
            const name = window._uidMap?.[uid]?.name || uid;
            logActivity('participant', `<b>${_authorName()}</b> promoted <b>${name}</b> to Admin`);
          });
      });
      return;
    }

    if (demoteBtn) {
      const uid = demoteBtn.dataset.uid;
      db.doc(`boards/${BOARD_ID}`).get().then(snap => {
        if (!snap.exists) return;
        const bd      = snap.data();
        if ((bd.users?.admins || [])[0] === uid) return; // cannot demote primary admin
        const admins  = (bd.users?.admins  || []).filter(u => u !== uid);
        const members = [...(bd.users?.members || []), uid];
        db.doc(`boards/${BOARD_ID}`).update({ 'users.admins': admins, 'users.members': members })
          .then(() => {
            renderParticipants(admins, [...admins, ...members]);
            renderTeamPanel(admins, members, bd.users?.nonMembers || [], document.getElementById('teamSearch').value.trim());
            document.getElementById('teamPanelCount').textContent = admins.length + members.length + (bd.users?.nonMembers?.length || 0);
            const name = window._uidMap?.[uid]?.name || uid;
            logActivity('participant', `<b>${_authorName()}</b> demoted <b>${name}</b> to Member`);
          });
      });
      return;
    }

    if (removeBtn) {
      const uid  = removeBtn.dataset.uid;
      const name = window._uidMap?.[uid]?.name || 'this user';
      Swal.fire({
        title: 'Remove access?',
        html: `Remove <b>${name}</b> from this board?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Remove',
        confirmButtonColor: '#e05252',
        cancelButtonText: 'Cancel',
        reverseButtons: true
      }).then(result => {
        if (!result.isConfirmed) return;
        db.doc(`boards/${BOARD_ID}`).get().then(snap => {
          if (!snap.exists) return;
          const bd      = snap.data();
          const admins  = bd.users?.admins  || [];
          const members = (bd.users?.members || []).filter(u => u !== uid);
          db.doc(`boards/${BOARD_ID}`).update({ 'users.members': members }).then(() => {
            renderParticipants(admins, [...admins, ...members]);
            renderTeamPanel(admins, members, bd.users?.nonMembers || [], document.getElementById('teamSearch').value.trim());
            document.getElementById('teamPanelCount').textContent = admins.length + members.length + (bd.users?.nonMembers?.length || 0);
            logActivity('participant', `<b>${_authorName()}</b> removed <b>${name}</b> from the board`);
            // Remove avatar from topbar if present
            document.querySelector(`.participant-avatar[data-uid='${uid}']`)?.remove();
          });
        }).catch(() => showToast('Could not remove user', true));
      });
      return;
    }
  });

  participantEmail.addEventListener('keydown', e => {
    if (e.key === 'Enter')  participantAddConfirm.click();
    if (e.key === 'Escape') closeTeamPanel();
  });

  participantAddConfirm.addEventListener('click', () => {
    const email = participantEmail.value.trim().toLowerCase();
    if (!email) { participantMsg.textContent = 'Please enter an email address.'; return; }
    participantMsg.className = 'team-panel__msg';
    participantMsg.textContent = 'Searching\u2026';
    db.collection('users').where('email', '==', email).get()
      .then(snap => {
        if (snap.empty) {
          // User not registered — send an invitation
          db.doc(`boards/${BOARD_ID}`).get().then(boardSnap => {
            if (!boardSnap.exists) { participantMsg.textContent = 'Board not found.'; return; }
            const bd         = boardSnap.data();
            const admins     = bd.users?.admins     || [];
            const members    = bd.users?.members    || [];
            const nonMembers = bd.users?.nonMembers || [];
            if (nonMembers.includes(email)) {
              participantMsg.textContent = 'Invitation already sent to this email.';
              return;
            }
            const boardName     = bd.name || 'a shared board';
            const newNonMembers = [...nonMembers, email];
            const batch = db.batch();
            batch.update(db.doc(`boards/${BOARD_ID}`), { 'users.nonMembers': newNonMembers });
            const invRef = db.collection('invitations').doc();
            batch.set(invRef, {
              email,
              boardId:       BOARD_ID,
              boardName,
              invitedBy:     currentUser.uid,
              invitedAt:     firebase.firestore.FieldValue.serverTimestamp(),
              status:        'pending'
            });
            batch.commit().then(() => {
              window._pendingEmails = newNonMembers;
              participantMsg.className = 'team-panel__msg ok';
              participantMsg.textContent = `Invite sent — ${email} will see it when they sign in`;
              participantEmail.value = '';
              renderTeamPanel(admins, members, newNonMembers, document.getElementById('teamSearch').value.trim());
              document.getElementById('teamPanelCount').textContent = admins.length + members.length + newNonMembers.length;
              logActivity('participant', `<b>${_authorName()}</b> invited <b>${email}</b> (pending sign-up)`);
            }).catch(err => {
              console.error(err);
              participantMsg.textContent = 'Error sending invitation.';
            });
          }).catch(err => {
            console.error(err);
            participantMsg.textContent = 'Error. Please try again.';
          });
          return;
        }
        const foundUid = snap.docs[0].id;
        return db.doc(`boards/${BOARD_ID}`).get().then(boardSnap => {
          if (!boardSnap.exists) return;
          const boardData  = boardSnap.data();
          const admins  = boardData.users?.admins  || (boardData.admins ? boardData.admins : (boardData.owner ? [boardData.owner] : []));
          const members = boardData.users?.members || [];
          const nonMembers = boardData.users?.nonMembers || [];
          if (admins.includes(foundUid) || members.includes(foundUid)) {
            participantMsg.textContent = 'User is already a participant.';
            return;
          }
          const newMembers = [...members, foundUid];
          return db.doc(`boards/${BOARD_ID}`).update({ 'users.members': newMembers }).then(() => {
            participantMsg.className = 'team-panel__msg ok';
            participantMsg.textContent = 'Member added!';
            participantEmail.value = '';
            renderParticipants(admins, [...admins, ...newMembers]);
            // Cache the new user's profile
            const addedData = snap.docs[0].data();
            _uidMapSet(foundUid, {
              name:  addedData.displayName || addedData.email || 'User',
              photo: addedData.photoURL || '',
              email: addedData.email || ''
            });
            renderTeamPanel(admins, newMembers, nonMembers, document.getElementById('teamSearch').value.trim());
            document.getElementById('teamPanelCount').textContent = admins.length + newMembers.length + nonMembers.length;
            const addedName = addedData.displayName || addedData.email || email;
            logActivity('participant', `<b>${_authorName()}</b> added <b>${addedName}</b> as a member`);
          });
        });
      })
      .catch(err => {
        console.error(err);
        participantMsg.textContent = 'Error. Please try again.';
      });
  });

  // ── Board options dropdown (rename / delete / leave) ─────────────────────
  const boardOptionsBtn = document.getElementById('boardOptionsBtn');
  const boardDropdown   = document.getElementById('boardDropdown');

  boardOptionsBtn.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = !boardDropdown.classList.contains('open');
    closeAllPopups(['boardDropdown']);
    boardDropdown.classList.toggle('open', willOpen);
  });
  document.addEventListener('click', e => {
    if (!boardDropdown.contains(e.target) && e.target !== boardOptionsBtn) {
      boardDropdown.classList.remove('open');
    }
  });

  // ── Storage dropdown (Archive + Trash) removed ──

  document.getElementById('boardOptFavourite').addEventListener('click', () => {
    boardDropdown.classList.remove('open');
    if (!currentUser) return;
    const isFav = userFavouriteBoard === BOARD_ID;
    const updateObj = isFav
      ? { favourite: firebase.firestore.FieldValue.delete() }
      : { favourite: BOARD_ID };
    db.collection('users').doc(currentUser.uid).update(updateObj)
      .then(() => {
        userFavouriteBoard = isFav ? null : BOARD_ID;
        const favStar = document.getElementById('boardFavStar');
        if (favStar) favStar.classList.toggle('visible', !isFav);
        const favLbl = document.getElementById('boardOptFavouriteLabel');
        const favBtn = document.getElementById('boardOptFavourite');
        if (favLbl) favLbl.textContent = isFav ? 'Make favourite' : 'Remove favourite';
        favBtn?.classList.toggle('fav-active', !isFav);
        showToast(isFav ? 'Favourite removed' : '⭐ Board set as favourite');
      })
      .catch(() => showToast('Could not update favourite', true));
  });

  document.getElementById('boardOptRename').addEventListener('click', () => {
    boardDropdown.classList.remove('open');
    const current = document.getElementById('boardComboLabel').textContent;
    Swal.fire({
      title: 'Rename board',
      input: 'text',
      inputValue: current,
      inputLabel: 'Board name',
      confirmButtonText: 'Rename',
      confirmButtonColor: 'var(--purple)',
      showCancelButton: true,
      inputValidator: v => !v.trim() && 'Please enter a name.'
    }).then(result => {
      if (!result.isConfirmed) return;
      const val = result.value.trim();
      db.doc(`boards/${BOARD_ID}`).update({ name: val })
        .then(() => {
          const item = document.getElementById('boardComboMenu').querySelector(`[data-board-id="${BOARD_ID}"]`);
          if (item) item.textContent = val;
          document.getElementById('boardComboLabel').textContent = val;
          showToast('Board renamed ✅');
        })
        .catch(() => showToast('Rename failed', true));
    });
  });

  document.getElementById('boardOptDelete').addEventListener('click', () => {
    boardDropdown.classList.remove('open');
    const boardName = document.getElementById('boardComboLabel').textContent;
    Swal.fire({
      title: 'Delete board?',
      html: `<b>${boardName}</b> will be permanently deleted. This cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#e05252',
      reverseButtons: true
    }).then(result => {
      if (!result.isConfirmed) return;
      db.doc(`boards/${BOARD_ID}`).delete()
        .then(() => {
          showToast('Board deleted');
          const menu = document.getElementById('boardComboMenu');
          const item = menu.querySelector(`[data-board-id="${BOARD_ID}"]`);
          if (item) item.remove();
          const next = menu.querySelector('.board-combo__item');
          if (next) {
            loadBoard(next.dataset.boardId);
          } else {
            board.innerHTML = '';
            document.getElementById('boardComboLabel').textContent = 'Select board';
          }
        })
        .catch(err => { console.error(err); showToast('Delete failed', true); });
    });
  });

  document.getElementById('boardOptLeave').addEventListener('click', () => {
    boardDropdown.classList.remove('open');
    const boardName = document.getElementById('boardComboLabel').textContent;
    Swal.fire({
      title: 'Leave board?',
      html: `You will lose access to <b>${boardName}</b>.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Leave',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#e05252',
      reverseButtons: true
    }).then(result => {
      if (!result.isConfirmed) return;
      const uid = currentUser?.uid;
      if (!uid) return;
      db.doc(`boards/${BOARD_ID}`).get().then(snap => {
        if (!snap.exists) return;
        const bd      = snap.data();
        const admins  = (bd.users?.admins  || []).filter(u => u !== uid);
        const members = (bd.users?.members || []).filter(u => u !== uid);
        db.doc(`boards/${BOARD_ID}`).update({ 'users.admins': admins, 'users.members': members })
          .then(() => {
            showToast('You have left the board');
            const menu = document.getElementById('boardComboMenu');
            const item = menu?.querySelector(`[data-board-id="${BOARD_ID}"]`);
            if (item) item.remove();
            const next = menu?.querySelector('.board-combo__item');
            if (next) {
              loadBoard(next.dataset.boardId);
            } else {
              board.innerHTML = '';
              document.getElementById('boardComboLabel').textContent = 'Select board';
            }
          })
          .catch(() => showToast('Could not leave board', true));
      });
    });
  });

  // -- Export board -------------------------------------------------------
  document.getElementById('boardOptRestoreCards').addEventListener('click', async () => {
    boardDropdown.classList.remove('open');
    if (!BOARD_ID) return;

    const knownIds = new Set(
      [...document.querySelectorAll('.project-column')].map(c => +c.dataset.columnId)
    );

    // Also include columns currently in the collapsed bar
    document.getElementById('collapsedBar')?.querySelectorAll('.project-column').forEach(c => {
      knownIds.add(+c.dataset.columnId);
    });

    let snap;
    try {
      snap = await db.collection(`boards/${BOARD_ID}/tasks`).get();
    } catch (err) {
      showToast('Could not load tasks: ' + err.message, true);
      return;
    }

    const orphansByColId = new Map();
    snap.docs.forEach(doc => {
      const data = { id: doc.id, ...doc.data() };
      if (!knownIds.has(+data.columnId)) {
        if (!orphansByColId.has(data.columnId)) orphansByColId.set(data.columnId, []);
        orphansByColId.get(data.columnId).push(data);
      }
    });

    if (!orphansByColId.size) {
      showToast('No lost cards found — all tasks belong to existing columns.');
      return;
    }

    let totalRestored = 0;
    orphansByColId.forEach((orphanTasks, missingColId) => {
      const div = document.createElement('div');
      div.className = 'project-column';
      const newId = nextColId++;
      div.dataset.columnId = newId;
      div.dataset.colOrder = nextColOrder++;
      const label = `Restored (${missingColId})`;
      div.innerHTML = `<div class='project-column-heading'>
        <h2 class='project-column-heading__title'>${label}</h2>
        <span class='col-count'>0</span>
        <button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button>
      </div>`;
      board.appendChild(div);
      setupColDropdown(div);
      orphanTasks
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach(taskData => div.appendChild(renderCard(taskData)));
      totalRestored += orphanTasks.length;
    });

    syncGrid();
    refreshAllColCounts();
    saveChanges(true);
    showToast(`Restored ${totalRestored} card(s) into ${orphansByColId.size} new column(s). Rename and save to keep.`);
  });

  document.getElementById('boardOptExport').addEventListener('click', () => {
    boardDropdown.classList.remove('open');
    if (!BOARD_ID) return;
    const boardName = document.getElementById('boardComboLabel').textContent || 'board';
    // Build export data from live DOM
    const cols = [...document.querySelector('.project-tasks').querySelectorAll('.project-column')];
    const exportData = {
      board: boardName,
      exportedAt: new Date().toISOString(),
      columns: cols.map(col => ({
        id:    col.dataset.columnId,
        title: col.querySelector('.project-column-heading__title')?.textContent || '',
        cards: [...col.querySelectorAll(':scope > .task')].map(c => serializeTask(c))
      }))
    };
    Swal.fire({
      title: 'Export Board',
      html: `<p style="margin-bottom:12px">Choose export format for <b>${boardName}</b>:</p>`,
      showCancelButton: true,
      confirmButtonText: '<i class="fas fa-file-code"></i> JSON',
      cancelButtonText:  '<i class="fas fa-file-csv"></i> CSV',
      showDenyButton: false,
      confirmButtonColor: 'var(--purple)',
      cancelButtonColor: '#6b7280',
      reverseButtons: false
    }).then(result => {
      if (result.isConfirmed) {
        // JSON export
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `${boardName.replace(/\s+/g, '-')}-export.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (result.isDismissed && result.dismiss === Swal.DismissReason.cancel) {
        // CSV export — flatten all cards
        const rows = [['Column','Title','Description','Tag','Priority','Assignee','Start Date','Deadline','Created']];
        exportData.columns.forEach(col => {
          col.cards.forEach(card => {
            rows.push([
              col.title,
              card.title  || '',
              card.text   || '',
              card.tag    || '',
              card.priority || '',
              card.assignee || '',
              card.startDate || '',
              card.deadline  || '',
              card.created   || ''
            ].map(v => `"${String(v).replace(/"/g, '""')}"`));
          });
        });
        const csv  = rows.map(r => r.join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `${boardName.replace(/\s+/g, '-')}-export.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  });

  // ── Board background picker ─────────────────────────────────────────────────
  const BG_PRESETS = [
    { label: 'Ocean',    value: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',                    dark: true  },
    { label: 'Sunset',   value: 'linear-gradient(135deg,#f093fb 0%,#f5576c 100%)',                    dark: false },
    { label: 'Forest',   value: 'linear-gradient(135deg,#11998e 0%,#38ef7d 100%)',                    dark: true  },
    { label: 'Midnight', value: 'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)',        dark: true  },
    { label: 'Peach',    value: 'linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%)',                    dark: false },
    { label: 'Sky',      value: 'linear-gradient(135deg,#a1c4fd 0%,#c2e9fb 100%)',                    dark: false },
    { label: 'Rose',     value: 'linear-gradient(135deg,#fbc2eb 0%,#a6c1ee 100%)',                    dark: false },
    { label: 'Dusk',     value: 'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',        dark: true  },
    { label: 'Sand',     value: 'linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%)',                    dark: false },
    { label: 'Calm',     value: 'linear-gradient(135deg,#dce0d9 0%,#ead7c3 100%)',                    dark: false },
    { label: 'Ember',    value: 'linear-gradient(135deg,#f7971e 0%,#ffd200 100%)',                    dark: false },
    { label: 'Steel',    value: 'linear-gradient(135deg,#606c88 0%,#3f4c6b 100%)',                    dark: true  },
    { label: 'Lime',    value: 'linear-gradient(135deg,#aac0aa 0%,#cbe896 100%)',                    dark: false  },
     { label: 'Nectar',    value: 'linear-gradient(135deg,#daddd8 0%,#ecebe4 100%)',                    dark: false  },
    { label: 'Dawn',    value: 'linear-gradient(135deg,#e0e1dd 0%,#778da9 100%)',                    dark: false  },
    { label: 'Dusk',    value: 'linear-gradient(135deg,#495057 0%,#6c757d 100%)',                    dark: true  },
  ];

  const bgPanel      = document.getElementById('boardBgPanel');
  const bgPresetsEl  = document.getElementById('boardBgPresets');
  const bgUrlInput   = document.getElementById('boardBgUrlInput');
  const bgUrlApply   = document.getElementById('boardBgUrlApply');
  const bgClearBtn   = document.getElementById('boardBgClear');
  const appContent   = document.querySelector('.app-content');
  let _currentBg     = null; // { type, value }

  // Build preset swatches
  BG_PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'board-bg-preset';
    btn.title = p.label;
    btn.style.background = p.value;
    btn.dataset.bgValue = p.value;
    btn.addEventListener('click', () => applyBackground(p.value, 'gradient', p.dark));
    bgPresetsEl.appendChild(btn);
  });

  function applyBackground(value, type, isDark = true) {
    _currentBg = value ? { type, value, dark: isDark } : null;
    document.body.style.backgroundImage = value || '';
    document.body.classList.toggle('has-bg', !!value);
    document.body.classList.toggle('bg-is-dark', !!value && !!isDark);
    appContent.classList.toggle('has-bg', !!value);
    appContent.classList.toggle('bg-is-dark', !!value && !!isDark);
    bgPresetsEl.querySelectorAll('.board-bg-preset').forEach(b => {
      b.classList.toggle('active', b.dataset.bgValue === value);
    });
    if (BOARD_ID) {
      db.doc(`boards/${BOARD_ID}`).update({
        background: value ? { type, value, dark: isDark } : firebase.firestore.FieldValue.delete()
      }).catch(() => showToast('Could not save background', true));
    }
    bgPanel.classList.remove('open');
    setTimeout(() => window._updateIconContrast?.(), 80);
  }

  window._applyBoardBackground = function(bg) {
    _currentBg = bg || null;
    const value = bg?.value || '';
    const isDark = bg ? (bg.dark !== false) : false;
    document.body.style.backgroundImage = value;
    document.body.classList.toggle('has-bg', !!value);
    document.body.classList.toggle('bg-is-dark', !!value && isDark);
    appContent.classList.toggle('has-bg', !!value);
    appContent.classList.toggle('bg-is-dark', !!value && isDark);
    bgPresetsEl.querySelectorAll('.board-bg-preset').forEach(b => {
      b.classList.toggle('active', b.dataset.bgValue === value);
    });
  };

  document.getElementById('boardOptBackground').addEventListener('click', () => {
    boardDropdown.classList.remove('open');
    bgPanel.classList.toggle('open');
    bgUrlInput.value = (_currentBg?.type === 'url' && _currentBg.value)
      ? _currentBg.value.replace(/^url\(["']?/, '').replace(/["']?\)$/, '')
      : '';
  });

  document.getElementById('boardBgPanelBack').addEventListener('click', () => bgPanel.classList.remove('open'));

  bgUrlApply.addEventListener('click', () => {
    const raw = bgUrlInput.value.trim();
    if (!raw) return;
    applyBackground(`url(${JSON.stringify(raw)})`, 'url', true); // image URLs default to dark treatment
  });
  bgUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') bgUrlApply.click(); });

  bgClearBtn.addEventListener('click', () => applyBackground('', null));

  document.addEventListener('click', e => {
    if (!bgPanel.contains(e.target) && e.target !== document.getElementById('boardOptBackground')) {
      bgPanel.classList.remove('open');
    }
  });

  // -- Custom board combobox toggle --------------------------------------------
  const boardComboTrigger = document.getElementById('boardComboTrigger');
  const boardComboMenu    = document.getElementById('boardComboMenu');
  boardComboTrigger.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = !boardComboMenu.classList.contains('open');
    closeAllPopups(['boardComboMenu']);
    boardComboMenu.classList.toggle('open', willOpen);
    boardComboTrigger.classList.toggle('open', willOpen);
  });
  document.addEventListener('click', e => {
    if (!document.getElementById('boardCombo').contains(e.target)) {
      boardComboMenu.classList.remove('open');
      boardComboTrigger.classList.remove('open');
    }
  });
  boardComboMenu.addEventListener('click', e => e.stopPropagation());

  // ── Add board from combo footer ──────────────────────────────────────────
  document.getElementById('boardComboNewInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('boardComboNewAdd').click();
  });
  document.getElementById('boardComboNewAdd').addEventListener('click', () => {
    const input = document.getElementById('boardComboNewInput');
    const name  = input.value.trim();
    if (!name) { input.focus(); return; }
    input.value = '';
    boardComboMenu.classList.remove('open');
    document.getElementById('boardComboTrigger').classList.remove('open');
    createBoard(name);
  });

  // -- Create a new board ------------------------------------------------------
  function createBoard(name) {
    const uid = currentUser ? currentUser.uid : null;
    const tags = window._getDefaultTags ? window._getDefaultTags() : [];
    const data = {
      name,
      users: { admins: uid ? [uid] : [], members: [] },
      tags,
      columns: [
        { id: 1,  title: 'To Do'       },
        { id: 2,  title: 'In Progress' },
        { id: 3,  title: 'Review'      },
        { id: 98, title: 'Done'        },
        { id: 99,  title: 'Archive', archive: true },
        { id: 100, title: 'Trash',   trash:   true }
      ]
    };
    const ts     = Date.now();
    const author = _authorName();
    const now    = fmtDate(ts);
    data.activity = [{
      type: 'create',
      text: `<b>${author}</b> created this board — "<em>${name}</em>"`,
      date: now,
      ts
    }];
    return db.collection('boards').add(data)
      .then(docRef => {
        addBoardSelectOption(docRef.id, name);
        // ── Add default "Get started" card to the first column (To Do = id 1) ──
        const taskId = db.collection(`boards/${docRef.id}/tasks`).doc().id;
        const taskTs = Date.now();
        const welcomeTask = {
          id:          taskId,
          boardId:     docRef.id,
          columnId:    1,
          order:       0,
          title:       'Get started with your board!',
          text:        'Welcome! This board is your workspace — customize it and start tracking your work.',
          tag:         'feature',
          priority:    'low',
          todos: [
            { text: 'Rename this board to something meaningful',  done: false, startDate: '', endDate: '' },
            { text: 'Add/remove/rename columns',                  done: false, startDate: '', endDate: '' },
            { text: 'Create your first real card',                done: false, startDate: '', endDate: '' },
            { text: 'Set a deadline or priority on a card',       done: false, startDate: '', endDate: '' },
            { text: 'Try filtering or searching cards',           done: false, startDate: '', endDate: '' },
            { text: 'Delete this card when you\'re ready',        done: false, startDate: '', endDate: '' },
          ],
          link:        '',
          startDate:   '',
          deadline:    '',
          assignee:    '',
          flagDate:    '',
          comments:    0,
          attachments: 0,
          created:     new Date(taskTs).toISOString(),
          createdBy:   uid || '',
          timeline: [{
            type:   'create',
            author: uid || '',
            text:   `<b>${author}</b> created this card`,
            date:   now,
            ts:     taskTs
          }]
        };
        db.collection(`boards/${docRef.id}/tasks`).doc(taskId).set(welcomeTask).catch(() => {});
        loadBoard(docRef.id);
        return docRef;
      })
      .catch(err => { console.error('Create board failed:', err); showToast('Could not create board', true); });
  }

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  function clearHighlights() {
    document.querySelectorAll('.task-hover').forEach(t => t.classList.remove('task-hover'));
    document.querySelectorAll('.column-drag-over').forEach(c => c.classList.remove('column-drag-over'));
    document.querySelectorAll('.col-drop-before,.col-drop-after').forEach(c => c.classList.remove('col-drop-before','col-drop-after'));
  }

  let dragSrcEls = []; // all cards being moved in a multi-card drag
  let dragSrcCol = null; // column being reordered via header drag

  board.addEventListener('dragstart', e => {
    // ── Column reorder drag ──────────────────────────────────────────────
    const colHandle = e.target.closest('.col-drag-handle');
    if (colHandle) {
      dragSrcCol = colHandle.closest('.project-column');
      dragSrcCol.classList.add('col-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
      return;
    }
    const task = e.target.closest('.task');
    if (!task) return;
    if (openColDropdown) { openColDropdown.classList.remove('open'); openColDropdown = null; }
    if (openDropdown)    { openDropdown.classList.remove('open');    openDropdown    = null; }
    dragSrcEl = task;
    // If the dragged card is part of a bulk selection, carry all selected cards
    const isMulti = task.classList.contains('task--selected');
    dragSrcEls = isMulti ? [...board.querySelectorAll('.task--selected')] : [];
    // Rotated ghost drag image
    const _ghost = task.cloneNode(true);
    _ghost.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${task.offsetWidth}px;transform:rotate(2deg) scale(1.03);opacity:0.9;pointer-events:none;border-radius:12px;box-shadow:0 16px 40px rgba(99,102,241,0.25),0 4px 12px rgba(0,0,0,0.15);`;
    document.body.appendChild(_ghost);
    e.dataTransfer.setDragImage(_ghost, task.offsetWidth / 2, 40);
    requestAnimationFrame(() => { if (_ghost.parentNode) _ghost.parentNode.removeChild(_ghost); });
    setTimeout(() => {
      task.style.opacity = '0.4';
      if (isMulti) dragSrcEls.forEach(c => { if (c !== task) c.style.opacity = '0.4'; });
    }, 0);
    e.dataTransfer.effectAllowed = 'move';
  });

  board.addEventListener('dragend', () => {
    if (dragSrcCol) {
      dragSrcCol.classList.remove('col-dragging');
      dragSrcCol = null;
      clearHighlights();
      return;
    }
    _clearColHoverExpand();
    if (dragSrcEl) dragSrcEl.style.opacity = '1';
    dragSrcEls.forEach(c => { c.style.opacity = '1'; });
    dragSrcEls = [];
    clearHighlights();
    dragSrcEl = null;
  });

  board.addEventListener('dragover', e => {
    e.preventDefault();
    // ── Column reorder drag-over ─────────────────────────────────────────
    if (dragSrcCol) {
      e.dataTransfer.dropEffect = 'move';
      clearHighlights();
      const overCol = e.target.closest('.project-column');
      if (overCol && overCol !== dragSrcCol && !overCol.classList.contains('project-column--archive') && !overCol.classList.contains('project-column--trash')) {
        const rect = overCol.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          overCol.classList.add('col-drop-before');
        } else {
          overCol.classList.add('col-drop-after');
        }
      }
      return;
    }
    e.dataTransfer.dropEffect = window._dragTemplate ? 'copy' : 'move';
    clearHighlights();
    const task = e.target.closest('.task');
    // In multi-card drag, always highlight the column — not individual cards
    if (task && task !== dragSrcEl && !dragSrcEls.length) {
      task.classList.add('task-hover');
    } else {
      const col = e.target.closest('.project-column');
      if (col) col.classList.add('column-drag-over');
    }
  });

  board.addEventListener('dragleave', e => {
    if (!board.contains(e.relatedTarget)) clearHighlights();
  });

  board.addEventListener('drop', e => {
    e.preventDefault();

    // ── Column reorder drop ──────────────────────────────────────────────
    if (dragSrcCol) {
      clearHighlights();
      dragSrcCol.classList.remove('col-dragging');
      const targetCol = e.target.closest('.project-column');
      if (targetCol && targetCol !== dragSrcCol && !targetCol.classList.contains('project-column--archive') && !targetCol.classList.contains('project-column--trash')) {
        // Snapshot previous order for undo
        const prevOrder = [...board.querySelectorAll('.project-column:not(.project-column--archive):not(.project-column--trash)')];
        const rect = targetCol.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          board.insertBefore(dragSrcCol, targetCol);
        } else {
          targetCol.insertAdjacentElement('afterend', dragSrcCol);
        }
        // Reassign colOrder values to reflect the new DOM order
        [...board.querySelectorAll('.project-column:not(.project-column--archive):not(.project-column--trash)')]
          .forEach((col, i) => { col.dataset.colOrder = i; });
        syncGrid();
        saveChanges(true);
        // Undo toast
        const movedTitle = dragSrcCol.querySelector('.project-column-heading__title')?.textContent || 'Column';
        showUndoToast(`"${movedTitle}" moved`, () => {
          // Restore previous DOM order
          prevOrder.forEach(col => board.insertBefore(col, board.querySelector('.project-column--archive') || null));
          [...board.querySelectorAll('.project-column:not(.project-column--archive):not(.project-column--trash)')]
            .forEach((col, i) => { col.dataset.colOrder = i; });
          syncGrid();
          saveChanges(true);
        });
      }
      dragSrcCol = null;
      return;
    }

    // ── Template drag-in from the popup ──────────────────────────────────
    if (window._dragTemplate) {
      const tpl = window._dragTemplate;
      window._dragTemplate = null;
      clearHighlights();
      const col = e.target.closest('.project-column');
      if (!col || col.classList.contains('project-column--trash')) return;
      const newId    = db.collection(`boards/${BOARD_ID}/tasks`).doc().id;
      const now      = new Date().toISOString();
      const cardData = {
        id:       newId,
        title:    tpl.title    || '',
        text:     tpl.text     || '',
        tag:      tpl.tag      || 'task',
        priority: tpl.priority || '',
        todos:    (tpl.todos   || []).map(t => ({ text: t.text, done: false, startDate: '', endDate: '' })),
        link:     tpl.link     || '',
        created:  now,
        author:   currentUser?.uid || '',
        timeline: [],
        order:    9999
      };
      const newCard = renderCard(cardData);
      col.appendChild(newCard);
      newCard.classList.add('task--new');
      setTimeout(() => newCard.classList.remove('task--new'), 400);
      _addCardTlEntry(newCard, 'create', 'Card Created from Template');
      refreshAllColCounts();
      scheduleOverflowCheck();
      const colName = col.querySelector('.project-column-heading__title')?.textContent || '';
      logActivity('create', `<b>Card</b> "${cardData.title || cardData.text.slice(0, 40) || 'New card'}" added to <b>${colName}</b> from template`);
      saveTask(newCard, true);
      return;
    }

    if (!dragSrcEl) return;
    const task    = e.target.closest('.task');
    const col     = e.target.closest('.project-column');
    const colName = col ? col.querySelector('.project-column-heading__title')?.textContent : '';

    // ── Multi-card drag ─────────────────────────────────────────────────────
    if (dragSrcEls.length > 1) {
      if (!col) { dragSrcEl = null; dragSrcEls = []; return; }
      const newColId = +col.dataset.columnId;
      const cards = dragSrcEls.slice();
      cards.forEach(c => { c.style.opacity = '1'; col.appendChild(c); });
      // Assign orders by DOM position after appending
      const allSiblings = [...col.querySelectorAll(':scope > .task')];
      cards.forEach(c => { c.dataset.order = allSiblings.indexOf(c); });
      clearHighlights();
      refreshAllColCounts();
      scheduleOverflowCheck();
      logActivity('move', `<b>${cards.length} card${cards.length !== 1 ? 's' : ''}</b> moved to <b>${colName}</b>`);
      window._localWriteIds = window._localWriteIds || new Set();
      cards.forEach(c => {
        const id = c.dataset.id;
        const order = +c.dataset.order;
        window._localWriteIds.add(id);
        db.collection(`boards/${BOARD_ID}/tasks`).doc(id)
          .update({ columnId: newColId, order })
          .then(() => setTimeout(() => window._localWriteIds?.delete(id), 500))
          .catch(err => console.error('Multi-drag save failed:', err));
      });
      if (typeof window._bulkDeselectAll === 'function') window._bulkDeselectAll();
      dragSrcEl = null;
      dragSrcEls = [];
      return;
    }

    const cardText = dragSrcEl.querySelector('p')?.textContent.slice(0, 40) || 'Card';
    const fromTrash = dragSrcEl.closest('.project-column--trash') !== null;

    if (task && task !== dragSrcEl) {
      task.parentNode.insertBefore(dragSrcEl, task);
    } else if (col) {
      col.appendChild(dragSrcEl);
    }

    const toTrash = col && col.classList.contains('project-column--trash');

    if (toTrash && !fromTrash) {
      dragSrcEl.dataset.deletedAt = Date.now().toString();
      _addCardTlEntry(dragSrcEl, 'delete', 'Card Deleted');
    } else if (fromTrash && !toTrash) {
      delete dragSrcEl.dataset.deletedAt;
      _addCardTlEntry(dragSrcEl, 'create', 'Card Recovered');
    }

    logActivity('move', `<b>Card</b> "${cardText}" moved to <b>${colName}</b>`);
    if (col && +col.dataset.columnId === 98 && window.launchConfetti) {
      const rect = dragSrcEl.getBoundingClientRect();
      const tagEl = dragSrcEl.querySelector('.task__tag');
      const tagColor = tagEl ? getComputedStyle(tagEl).backgroundColor : null;
      window.launchConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2, tagColor);
    }
    dragSrcEl.style.opacity = '1';
    clearHighlights();
    scheduleOverflowCheck();

    // ── Single-document drag save (fractional order) ──
    const taskId    = dragSrcEl.dataset.id;
    const newColId  = col ? +col.dataset.columnId : null;
    if (taskId && newColId !== null) {
      const siblings = [...col.querySelectorAll(':scope > .task')];
      const idx      = siblings.indexOf(dragSrcEl);
      const prevOrder = idx > 0                    ? parseFloat(siblings[idx - 1].dataset.order || (idx - 1)) : null;
      const nextOrder = idx < siblings.length - 1  ? parseFloat(siblings[idx + 1].dataset.order || (idx + 1)) : null;
      let newOrder;
      if      (prevOrder === null && nextOrder === null) newOrder = 0;
      else if (prevOrder === null) newOrder = nextOrder - 1;
      else if (nextOrder === null) newOrder = prevOrder + 1;
      else                         newOrder = (prevOrder + nextOrder) / 2;
      dragSrcEl.dataset.order = newOrder;
      // Suppress real-time listener echo for our own drag write
      window._localWriteIds = window._localWriteIds || new Set();
      window._localWriteIds.add(taskId);
      if ((fromTrash && !toTrash) || (!fromTrash && toTrash)) {
        // Full save to persist timeline entry + deletedAt change
        saveTask(dragSrcEl, true)
          .then(() => setTimeout(() => window._localWriteIds?.delete(taskId), 500))
          .catch(err => console.error('Drag save failed:', err));
      } else {
        db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId)
          .update({ columnId: newColId, order: newOrder })
          .then(() => setTimeout(() => window._localWriteIds?.delete(taskId), 500))
          .catch(err => console.error('Drag save failed:', err));
      }
    }
    dragSrcEl = null;
  });

  // ── Drag onto collapsed bottom bar chips ───────────────────────────────
  let _colHoverExpandTimer = null;
  let _colHoverExpandTarget = null;

  function _clearColHoverExpand() {
    clearTimeout(_colHoverExpandTimer);
    _colHoverExpandTimer = null;
    _colHoverExpandTarget = null;
  }

  const collapsedBar = document.getElementById('collapsedBar');
  if (collapsedBar) {
    collapsedBar.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearHighlights();
      const col = e.target.closest('.project-column--collapsed');
      if (col) {
        col.classList.add('column-drag-over');
        // Expand-on-hover after 700ms
        if (col !== _colHoverExpandTarget) {
          _clearColHoverExpand();
          _colHoverExpandTarget = col;
          _colHoverExpandTimer = setTimeout(() => {
            if (_colHoverExpandTarget === col && (dragSrcEl || dragSrcEls.length)) {
              toggleColCollapse(col);
            }
            _clearColHoverExpand();
          }, 700);
        }
      } else {
        _clearColHoverExpand();
      }
    });

    collapsedBar.addEventListener('dragleave', e => {
      if (!collapsedBar.contains(e.relatedTarget)) {
        clearHighlights();
        _clearColHoverExpand();
      }
    });

    collapsedBar.addEventListener('drop', e => {
      e.preventDefault();
      clearHighlights();
      _clearColHoverExpand();
      if (!dragSrcEl && !dragSrcEls.length) return;
      const colEl = e.target.closest('.project-column--collapsed');
      if (!colEl) return;
      const newColId = +colEl.dataset.columnId;
      const colName  = colEl.querySelector('.project-column-heading__title')?.textContent || '';
      const cards    = dragSrcEls.length > 1 ? dragSrcEls.slice() : [dragSrcEl];

      cards.forEach(c => { c.style.opacity = '1'; colEl.appendChild(c); });
      const allSiblings = [...colEl.querySelectorAll(':scope > .task')];
      cards.forEach(c => { c.dataset.order = allSiblings.indexOf(c); });

      refreshAllColCounts();
      scheduleOverflowCheck();
      logActivity('move', `<b>${cards.length > 1 ? cards.length + ' cards' : 'Card'}</b> moved to <b>${colName}</b>`);

      window._localWriteIds = window._localWriteIds || new Set();
      cards.forEach(c => {
        const id    = c.dataset.id;
        const order = +c.dataset.order;
        window._localWriteIds.add(id);
        db.collection(`boards/${BOARD_ID}/tasks`).doc(id)
          .update({ columnId: newColId, order })
          .then(() => setTimeout(() => window._localWriteIds?.delete(id), 500))
          .catch(err => console.error('Bar drop save failed:', err));
      });

      if (typeof window._bulkDeselectAll === 'function') window._bulkDeselectAll();
      dragSrcEl  = null;
      dragSrcEls = [];
    });

    collapsedBar.addEventListener('click', e => {
      const colEl = e.target.closest('.project-column--collapsed');
      if (colEl) toggleColCollapse(colEl);
    });
  }

  // ── Collapsed-bar scroll arrows ──────────────────────────────────────────
  (() => {
    const bar   = document.getElementById('collapsedBar');
    const wrap  = document.getElementById('collapsedBarWrap');
    const btnL  = document.getElementById('collapsedBarScrollLeft');
    const btnR  = document.getElementById('collapsedBarScrollRight');
    if (!bar || !wrap || !btnL || !btnR) return;

    function updateScrollState() {
      const canLeft  = bar.scrollLeft > 2;
      const canRight = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2;
      wrap.classList.toggle('can-scroll-left',  canLeft);
      wrap.classList.toggle('can-scroll-right', canRight);
    }

    const SCROLL_STEP = 160;
    btnL.addEventListener('click', () => { bar.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' }); });
    btnR.addEventListener('click', () => { bar.scrollBy({ left:  SCROLL_STEP, behavior: 'smooth' }); });
    bar.addEventListener('scroll', updateScrollState, { passive: true });

    // Re-check whenever chips are added/removed
    const _barRO = new ResizeObserver(updateScrollState);
    _barRO.observe(bar);
    const _barMO = new MutationObserver(updateScrollState);
    _barMO.observe(bar, { childList: true });

    updateScrollState();
    // Expose so toggleColCollapse can trigger a refresh after moving chips
    window._updateCollapsedBarScroll = updateScrollState;
  })();
  const months       = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  function legacyDateToTs(dateStr) {
    if (!dateStr) return Date.now();
    // Try ISO / browser-recognised formats first
    let d = new Date(dateStr);
    if (!isNaN(d)) return d.getTime();
    // 'Mar 3' or 'Mar 3, 2026' – strip any time portion after comma
    const base = dateStr.replace(/,?\s*\d+:\d+.*$/, '').trim();
    const year = new Date().getFullYear();
    d = new Date(`${base} ${year}`);
    if (!isNaN(d) && d.getTime() <= Date.now()) return d.getTime();
    return new Date(`${base} ${year - 1}`).getTime() || Date.now();
  }
  let   nextColId    = 100;
  let   nextColOrder  = 0;

  function buildColumnsFromData(colData) {
    let maxId = 0;
    // Backward-compat: old boards stored columns as { columns: [] }
    const colArr = Array.isArray(colData) ? colData : (colData.columns || []);
    // Sort by seq (set during save) so columns render in the persisted order.
    // Archive/trash have no seq and always sort last.
    const sortedCols = colArr.slice().sort((a, b) => {
      const aSpec = (a.archive || a.trash) ? 1 : 0;
      const bSpec = (b.archive || b.trash) ? 1 : 0;
      if (aSpec !== bSpec) return aSpec - bSpec;
      return (a.seq ?? 9999) - (b.seq ?? 9999);
    });
    sortedCols.forEach((col, i) => {
      const div       = document.createElement('div');
      let cls = 'project-column';
      if (col.archive) cls += ' project-column--archive';
      if (col.trash)   cls += ' project-column--trash';
      div.className   = cls;
      div.dataset.columnId = col.id;
      // Reserve 997/998 for archive/trash so sidebar always sorts Archive → Trash
      if (col.archive) div.dataset.colOrder = 997;
      else if (col.trash) div.dataset.colOrder = 998;
      else div.dataset.colOrder = i;
      if (col.wipLimit) div.dataset.wipLimit = col.wipLimit;
      div.innerHTML   = `<div class='project-column-heading'>
        <h2 class='project-column-heading__title'>${col.title}</h2>
        <span class='col-count'>0</span>
        <button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button>
      </div>`;
      board.appendChild(div);
      setupColDropdown(div);
      if (col.collapsed || col.archive || col.trash) div.dataset.restoreCollapsed = '1';
      if (col.width)     div.dataset.colWidth = col.width;
      if (!col.archive && !col.trash && col.id < 97 && col.id > maxId) maxId = col.id;
    });
    nextColId    = maxId + 1;
    nextColOrder = colArr.length;
    syncGrid();
    // collapsed columns are restored by the caller after all migrations
  }

  function buildTasksFromData(data) {
    const colEls = [...document.querySelectorAll('.project-column')];
    data.columns.forEach((col, i) => {
      const colEl = colEls[i];
      if (!colEl) return;
      col.tasks.forEach(taskData => colEl.appendChild(renderCard(taskData)));
    });
  }

  // New format: tasks is a pre-sorted flat array; each task has a `columnId` field
  function buildTasksFromFlatData(tasks) {
    const colEls = [...document.querySelectorAll('.project-column')];
    const knownIds = new Set(colEls.map(c => +c.dataset.columnId));

    // Group tasks whose columnId has no matching column (lost due to save-race or manual deletion)
    const orphansByColId = new Map();
    tasks.forEach(taskData => {
      const colEl = colEls.find(c => +c.dataset.columnId === taskData.columnId);
      if (colEl) {
        colEl.appendChild(renderCard(taskData));
      } else {
        const id = taskData.columnId;
        if (!orphansByColId.has(id)) orphansByColId.set(id, []);
        orphansByColId.get(id).push(taskData);
      }
    });

    // Create a recovery column for each missing columnId so no cards are lost
    orphansByColId.forEach((orphanTasks, missingColId) => {
      const div = document.createElement('div');
      div.className = 'project-column';
      div.dataset.columnId = missingColId;
      div.dataset.colOrder = nextColOrder++;
      div.innerHTML = `<div class='project-column-heading'>
        <h2 class='project-column-heading__title'>Recovered (${missingColId})</h2>
        <span class='col-count'>0</span>
        <button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button>
      </div>`;
      board.appendChild(div);
      setupColDropdown(div);
      orphanTasks.forEach(taskData => div.appendChild(renderCard(taskData)));
      syncGrid();
      showToast(`⚠ Recovered ${orphanTasks.length} card(s) from a missing column — please rename and save.`, true);
    });

    refreshAllColCounts();
    // Check overflow after all cards are in the DOM and painted
    setTimeout(checkColumnOverflow, 80);
  }

  // ── Card expand / collapse animation helper ──────────────────────────────
  function setCardExpanded(task, expanded) {
    if (task.classList.contains('task--expanded') === expanded) return;
    const startH = task.offsetHeight;
    if (expanded) task.classList.add('task--expanded');
    else          task.classList.remove('task--expanded');
    refreshExpandBtn(task);
    const endH = task.offsetHeight;
    if (startH === endH) return;
    task.style.height   = startH + 'px';
    task.style.overflow = 'hidden';
    task.getBoundingClientRect(); // force reflow
    task.style.transition = 'height 0.28s cubic-bezier(0.4,0,.2,1)';
    task.style.height = endH + 'px';
    function finish(e) {
      if (e.propertyName !== 'height') return;
      task.removeEventListener('transitionend', finish);
      task.style.height = task.style.overflow = task.style.transition = '';
    }
    task.addEventListener('transitionend', finish);
  }

  // ── Auto-fit columns: clear all fixed widths so the grid redistributes evenly ──
  function autoFitColumns() {
    // Clear widths from board columns AND any chips currently in the collapsed bar
    document.querySelectorAll('.project-column').forEach(c => delete c.dataset.colWidth);
    syncGrid();
    scheduleOverflowCheck();
  }
  document.getElementById('autoResizeColsBtn')?.addEventListener('click', () => {
    autoFitColumns();
    saveChanges(true);
  });

  // ── Collapse / expand a column – moves element to/from the collapsed bottom bar ──
  function toggleColCollapse(colEl, skipSave) {
    const collapsedBar = document.getElementById('collapsedBar');
    const isCollapsed  = colEl.classList.contains('project-column--collapsed');
    const tasks        = [...colEl.querySelectorAll(':scope > .task')];

    if (isCollapsed) {
      // ── Expand: move from bottom bar back into board at correct sorted position ──
      colEl.classList.remove('project-column--collapsed');
      const myOrder   = +colEl.dataset.colOrder || 0;
      const boardCols = [...board.querySelectorAll('.project-column')];
      const anchor    = boardCols.find(c => (+c.dataset.colOrder || 0) > myOrder);
      if (anchor) board.insertBefore(colEl, anchor);
      else        board.appendChild(colEl);
      // Stagger-fade cards back in
      tasks.forEach((t, i) => {
        t.style.opacity    = '0';
        t.style.transform  = 'translateY(-10px)';
        t.style.transition = 'none';
        void t.offsetHeight;
        t.style.transition = `opacity 0.22s ${i * 28}ms ease, transform 0.22s ${i * 28}ms ease`;
        requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = ''; });
      });
      const expandWait = 220 + (tasks.length > 0 ? (tasks.length - 1) * 28 : 0) + 60;
      setTimeout(() => {
        tasks.forEach(t => { t.style.opacity = t.style.transform = t.style.transition = ''; });
        autoFitColumns(); // calls syncGrid + scheduleOverflowCheck internally
        saveChanges(true);
      }, expandWait);
    } else {
      // ── Collapse: fade cards out then move to bottom bar ──
      if (!colEl.dataset.colOrder) {
        const allCols = [...document.querySelectorAll('.project-column')];
        colEl.dataset.colOrder = allCols.indexOf(colEl);
      }
      const doCollapse = () => {
        colEl.classList.add('project-column--collapsed');
        tasks.forEach(t => { t.style.opacity = t.style.transform = t.style.transition = ''; });
        // Insert into bar in colOrder sort order
        const myOrder   = +colEl.dataset.colOrder;
        const barChips  = [...collapsedBar.querySelectorAll('.project-column--collapsed')];
        const anchor    = barChips.find(c => (+c.dataset.colOrder || 0) > myOrder);
        if (anchor) collapsedBar.insertBefore(colEl, anchor);
        else        collapsedBar.appendChild(colEl);
        syncGrid();
        autoFitColumns();
        scheduleOverflowCheck();
        refreshColCount(colEl);
        if (!skipSave) saveChanges(true);
      };
      if (!tasks.length) { doCollapse(); return; }
      tasks.forEach((t, i) => {
        t.style.transition = `opacity 0.16s ${i * 22}ms ease, transform 0.16s ${i * 22}ms ease`;
        t.style.opacity    = '0';
        t.style.transform  = 'translateY(-8px)';
      });
      setTimeout(doCollapse, 160 + (tasks.length - 1) * 22 + 30);
    }
  }

  // ── Column resize by dragging the right edge handle ──────────────────────
  (() => {
    let _resizeCol = null, _resizeStartX = 0, _resizeStartW = 0;
    let _liveOverflowTimer = null;
    let _resizeJustFinished = false;

    board.addEventListener('mousedown', e => {
      const handle = e.target.closest('.col-resize-handle');
      if (!handle) return;
      e.preventDefault();
      _resizeCol    = handle.closest('.project-column');
      _resizeStartX = e.clientX;
      _resizeStartW = _resizeCol.getBoundingClientRect().width;
      document.body.classList.add('col-resizing');
      handle.classList.add('dragging');
    });

    document.addEventListener('mousemove', e => {
      if (!_resizeCol) return;
      const w = Math.max(_SUBCOL_MIN_W, _resizeStartW + (e.clientX - _resizeStartX));
      _resizeCol.dataset.colWidth = Math.round(w);
      syncGrid();
      // Throttled live sub-col recalc (every 120ms during drag)
      clearTimeout(_liveOverflowTimer);
      _liveOverflowTimer = setTimeout(checkColumnOverflow, 120);
    });

    document.addEventListener('mouseup', () => {
      if (!_resizeCol) return;
      clearTimeout(_liveOverflowTimer);
      _resizeCol.querySelector('.col-resize-handle')?.classList.remove('dragging');
      document.body.classList.remove('col-resizing');
      scheduleOverflowCheck();
      saveChanges(true);
      _resizeCol = null;
      // Suppress the click event that the browser fires after mouseup
      _resizeJustFinished = true;
      setTimeout(() => { _resizeJustFinished = false; }, 0);
    });

    // Expose flag so the quick-add click handler can check it
    window._colResizeJustFinished = () => _resizeJustFinished;

    // Double-click handle → reset column to auto width
    board.addEventListener('dblclick', e => {
      const handle = e.target.closest('.col-resize-handle');
      if (!handle) return;
      e.stopPropagation();
      const col = handle.closest('.project-column');
      if (!col) return;
      delete col.dataset.colWidth;
      scheduleOverflowCheck();
      saveChanges(true);
    });
  })();

  // ── Quick-add: click empty area of a column to open Add Card modal ───────
  // Click anywhere on a collapsed-bar chip to expand it is handled in the collapsedBar listener above.

  board.addEventListener('click', e => {
    if (window._colResizeJustFinished?.()) return;
    if (e.target.closest('.task')) return;
    if (e.target.closest('.project-column-heading')) return;
    if (e.target.closest('.col-dropdown')) return;
    if (e.target.closest('.drop-zone')) return;
    if (e.target.closest('.col-resize-handle')) return;
    if (e.target.closest('.col-collapse-btn')) return;
    if (e.target.closest('.col-drag-handle')) return;
    const colEl = e.target.closest('.project-column');
    if (!colEl) return;
    if (colEl.classList.contains('project-column--archive')) return;
    if (colEl.classList.contains('project-column--trash')) return;
    const cols   = [...document.querySelectorAll('.project-column')];
    const colIdx = cols.indexOf(colEl);
    if (colIdx >= 0 && typeof window._openModal === 'function') window._openModal(colIdx);
  });

  // ── Card expand / collapse ───────────────────────────────────────────────
  board.addEventListener('click', e => {
    const task = e.target.closest('.task');
    if (!task) return;
    if (e.target.closest('.task__update-btn'))       return;
    if (e.target.closest('.task__cc-cancel'))        return;
    if (e.target.closest('.task__cc-submit'))        return;
    if (e.target.closest('.task__options'))          return;
    if (e.target.closest('.task__dropdown'))         return;
    if (e.target.closest('.task__edit-actions'))     return;
    if (e.target.closest('.task__comment-box'))      return;
    if (e.target.closest('.task__tl-edit-actions'))  return;
    if (e.target.closest('.task__tl-edit-input'))    return;
    if (e.target.closest('.task__tl-entry--editing')) return;
    if (e.target.closest('.task__select-wrap'))       return;
    if (e.target.closest('.task__todo-cb'))           return;
    if (task.classList.contains('task--expanded') && e.target.closest('.task__tl-text')) return;
    // Close any open timeline edit inputs across the whole board before toggling
    board.querySelectorAll('.task__tl-entry--editing').forEach(entry => {
      entry.classList.remove('task__tl-entry--editing');
      const textDiv = entry.querySelector('.task__tl-text');
      if (!textDiv) return;
      const t = textDiv._savedTime || '';
      textDiv.innerHTML = tlMetaHTML(textDiv.dataset.comment || '', t, textDiv._savedAuthor || '');
    });
    setCardExpanded(task, !task.classList.contains('task--expanded'));
  });

  // ── Task options dropdown ────────────────────────────────────────────────
  let openDropdown = null;
  document.addEventListener('click', e => {
    if (openDropdown && !openDropdown.contains(e.target) && !e.target.closest('.task__options')) {
      openDropdown.classList.remove('open');
      openDropdown = null;
    }
  });

  board.addEventListener('click', e => {
    // Toggle dropdown
    if (e.target.closest('.task__options')) {
      e.stopPropagation();
      const task   = e.target.closest('.task');
      const dd     = task.querySelector('.task__dropdown');
      const isOpen = dd.classList.contains('open');
      if (openDropdown && openDropdown !== dd) openDropdown.classList.remove('open');
      dd.classList.toggle('open', !isOpen);
      openDropdown = !isOpen ? dd : null;
      return;
    }
    // Duplicate card
    if (e.target.closest('.task__opt-duplicate')) {
      const task = e.target.closest('.task');
      task.querySelector('.task__dropdown').classList.remove('open');
      openDropdown = null;
      if (task.closest('.project-column--trash')) {
        showToast('Cannot duplicate a trashed card.', true);
        return;
      }
      const srcData  = serializeTask(task);
      const newId    = db.collection(`boards/${BOARD_ID}/tasks`).doc().id;
      const now      = new Date().toISOString();
      const copyData = {
        ...srcData,
        id:       newId,
        title:    (srcData.title || '') + ' (copy)',
        created:  now,
        author:   currentUser?.uid || '',
        timeline: [],
        order:    (task.nextElementSibling
          ? parseInt(task.nextElementSibling.dataset.order, 10) : 9999)
      };
      const copyCard = renderCard(copyData);
      task.after(copyCard);
      _addCardTlEntry(copyCard, 'create', 'Card Duplicated');
      refreshAllColCounts();
      saveTask(copyCard, true);
      logActivity('create', `<b>${_authorName()}</b> duplicated "${srcData.title || 'Card'}"`);
      return;
    }

    // Save as Template
    if (e.target.closest('.task__opt-save-template')) {
      const task = e.target.closest('.task');
      task.querySelector('.task__dropdown').classList.remove('open');
      openDropdown = null;
      if (!currentUser) { showToast('Sign in to save templates.', true); return; }
      const srcData = serializeTask(task);
      const templateData = {
        title:     srcData.title     || '',
        text:      srcData.text      || '',
        tag:       srcData.tag       || 'task',
        priority:  srcData.priority  || '',
        todos:     (srcData.todos    || []).map(t => ({ text: t.text, done: false, startDate: '', endDate: '' })),
        link:      srcData.link      || '',
        createdAt: Date.now(),
        name:      srcData.title     || srcData.text.slice(0, 40) || 'Template'
      };
      db.collection(`boards/${BOARD_ID}/templates`).add(templateData)
        .then(() => showToast('Saved as template ✓'))
        .catch(err => { console.error('Template save failed:', err); showToast('Failed to save template', true); });
      return;
    }

    // Edit — open modal
    if (e.target.closest('.task__opt-edit')) {
      const task = e.target.closest('.task');
      task.querySelector('.task__dropdown').classList.remove('open');
      openDropdown = null;
      if (task.closest('.project-column--trash')) {
        showToast('Restore the card before editing.', true);
        return;
      }
      if (window._boardRole === 'member' && task.dataset.createdByUid && task.dataset.createdByUid !== currentUser?.uid) {
        showToast('You can only edit your own tasks.', true);
        return;
      }
      if (window._openEditModal) window._openEditModal(task);
      return;
    }

    // Restore (from Trash)
    if (e.target.closest('.task__opt-restore')) {
      const task = e.target.closest('.task');
      task.querySelector('.task__dropdown').classList.remove('open');
      openDropdown = null;
      const firstNonSpecial = document.querySelector('.project-column:not(.project-column--archive):not(.project-column--trash)');
      if (!firstNonSpecial) { showToast('No column to restore to.', true); return; }
      delete task.dataset.deletedAt;
      delete task.dataset.deletedLabel;
      _addCardTlEntry(task, 'create', 'Card Recovered');
      firstNonSpecial.appendChild(task);
      refreshAllColCounts();
      saveTask(task, true);
      logActivity('move', `<b>${_authorName()}</b> restored "${task.querySelector('.task__title')?.textContent?.trim() || task.querySelector('p')?.textContent?.slice(0,40) || 'Card'}"`);
      return;
    }

    // Delete
    if (e.target.closest('.task__opt-delete')) {
      const task     = e.target.closest('.task');
      if (window._boardRole === 'member' && task.dataset.createdByUid && task.dataset.createdByUid !== currentUser?.uid) {
        showToast('You can only delete your own tasks.', true);
        task.querySelector('.task__dropdown')?.classList.remove('open');
        openDropdown = null;
        return;
      }
      const taskId   = task.dataset.id;
      const cardText = task.querySelector('p')?.textContent.slice(0, 40) || 'Card';
      const cardTitle = task.querySelector('.task__title')?.textContent?.trim() || cardText;
      const inTrash  = !!task.closest('.project-column--trash');

      if (inTrash) {
        Swal.fire({
          title: 'Delete permanently?',
          text: `"${cardTitle}" will be deleted forever and cannot be recovered.`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Delete Forever',
          confirmButtonColor: '#e05252',
          cancelButtonText: 'Cancel',
          reverseButtons: true
        }).then(result => {
          if (!result.isConfirmed) return;
          task.style.transition = 'opacity .2s';
          task.style.opacity    = '0';
          const deleteDoc = taskId
            ? db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId).delete().catch(err => console.warn('Could not delete task doc:', err))
            : Promise.resolve();
          setTimeout(() => { task.remove(); deleteDoc.then(() => { refreshAllColCounts(); saveChanges(true); }); }, 200);
          logActivity('delete', `<b>${_authorName()}</b> permanently deleted "${cardTitle}"`);
          openDropdown = null;
        });
        return;
      }

      // Move to Trash immediately — no confirmation dialog, undo available for 6 s
      const trashCol   = document.querySelector('.project-column--trash');
      const originCol  = task.closest('.project-column');
      const originNext = task.nextElementSibling;
      task.querySelector('.task__dropdown')?.classList.remove('open');
      openDropdown = null;
      if (trashCol) {
        task.dataset.deletedAt = Date.now().toString();
        task.style.transition = 'opacity .2s';
        task.style.opacity    = '0';
        setTimeout(() => {
          task.style.opacity = '';
          task.style.transition = '';
          trashCol.appendChild(task);
          _addCardTlEntry(task, 'delete', 'Card Deleted');
          refreshAllColCounts();
          saveTask(task, true);
        }, 200);
        logActivity('delete', `<b>${_authorName()}</b> deleted "${cardTitle}"`);
        showUndoToast(`"${cardTitle}" moved to Trash`, () => {
          delete task.dataset.deletedAt;
          delete task.dataset.deletedLabel;
          if (originCol) {
            if (originNext && originCol.contains(originNext)) originCol.insertBefore(task, originNext);
            else originCol.appendChild(task);
          }
          _addCardTlEntry(task, 'create', 'Card Recovered');
          refreshAllColCounts();
          saveTask(task, true);
          logActivity('move', `<b>${_authorName()}</b> restored "${cardTitle}"`);
        });
      } else {
        // Fallback: hard delete if no trash column exists
        task.style.transition = 'opacity .2s';
        task.style.opacity    = '0';
        const deleteDoc = taskId
          ? db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId).delete().catch(err => console.warn('Could not delete task doc:', err))
          : Promise.resolve();
        setTimeout(() => { task.remove(); deleteDoc.then(() => saveChanges(true)); }, 200);
        logActivity('delete', `<b>${_authorName()}</b> deleted "${cardTitle}"`);
      }
      return;
    }
  });

  // ── Inline comment edit ──────────────────────────────────────────────────
  board.addEventListener('click', e => {
    if (e.target.closest('.task__tl-text') && !e.target.closest('.task__tl-entry--editing')) {
      const entry = e.target.closest('.task__tl-entry');
      if (!entry || !entry.closest('.task--expanded')) return;
      const textDiv = entry.querySelector('.task__tl-text');
      if (!textDiv.dataset.comment && textDiv.dataset.comment !== '') return; // not a comment entry
      // Members can only edit their own comments
      const entryAuthor = entry.dataset.authorUid;
      if (window._boardRole === 'member' && entryAuthor && entryAuthor !== currentUser?.uid) return;
      const current = textDiv.dataset.comment || '';
      const metaTime = textDiv.querySelector('.task__tl-meta time')?.textContent || '';
      // Close any other open edits across the whole board
      board.querySelectorAll('.task__tl-entry--editing').forEach(other => {
        if (other === entry) return;
        other.classList.remove('task__tl-entry--editing');
        const otherDiv = other.querySelector('.task__tl-text');
        if (!otherDiv) return;
        const t = otherDiv._savedTime || '';
        otherDiv.innerHTML = tlMetaHTML(otherDiv.dataset.comment || '', t, otherDiv._savedAuthor || '');
      });
      entry.classList.add('task__tl-entry--editing');
      textDiv._savedTime   = metaTime;
      textDiv._savedAuthor = textDiv.querySelector('b')?.textContent || _authorName();
      textDiv.innerHTML    = `<textarea class='task__tl-edit-input' rows='2'>${current}</textarea>
        <div class='task__tl-edit-actions'>
          <button class='task__tl-edit-delete' title='Delete comment'><i class='fas fa-trash-alt'></i></button>
          <button class='task__tl-edit-cancel' title='Cancel'><i class='fas fa-times'></i></button>
          <button class='task__tl-edit-save' title='Save'><i class='fas fa-check'></i></button>
        </div>`;
      const ta = textDiv.querySelector('.task__tl-edit-input');
      ta.focus();
      ta.addEventListener('keydown', ev => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          entry.classList.remove('task__tl-entry--editing');
          const t = textDiv._savedTime || '';
          textDiv.innerHTML = tlMetaHTML(textDiv.dataset.comment || '', t, textDiv._savedAuthor || _authorName());
        }
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          entry.querySelector('.task__tl-edit-save')?.click();
        }
      });
      return;
    }
    if (e.target.closest('.task__tl-edit-delete')) {
      const entry = e.target.closest('.task__tl-entry');
      const entryAuthor = entry.dataset.authorUid;
      if (window._boardRole === 'member' && entryAuthor && entryAuthor !== currentUser?.uid) {
        showToast('You can only delete your own comments.', true);
        return;
      }
      const _taskEl  = entry.closest('.task');
      const cardText = _taskEl?.querySelector('p')?.textContent.slice(0, 40) || 'Card';
      Swal.fire({
        title: 'Are you sure?',
        text: 'This comment will be permanently deleted.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Delete',
        confirmButtonColor: '#e05252',
        cancelButtonText: 'Cancel',
        reverseButtons: true
      }).then(result => {
        if (!result.isConfirmed) return;
        entry.remove();
        logActivity('delete', `<b>${_authorName()}</b> deleted a comment on "${cardText}"`);
        saveTask(_taskEl, true);
      });
      return;
    }
    if (e.target.closest('.task__tl-edit-cancel')) {
      const entry   = e.target.closest('.task__tl-entry');
      const textDiv = entry.querySelector('.task__tl-text');
      const current = textDiv.dataset.comment || '';
      const time    = textDiv._savedTime || '';
      entry.classList.remove('task__tl-entry--editing');
      textDiv.innerHTML = tlMetaHTML(current, time, textDiv._savedAuthor || _authorName());
      return;
    }
    if (e.target.closest('.task__tl-edit-save')) {
      const entry   = e.target.closest('.task__tl-entry');
      const textDiv = entry.querySelector('.task__tl-text');
      const input   = textDiv.querySelector('.task__tl-edit-input');
      const newText = input.value.trim();
      if (!newText) { input.focus(); return; }
      const oldText = textDiv.dataset.comment || '';
      const time = textDiv._savedTime || '';
      entry.classList.remove('task__tl-entry--editing');
      textDiv.dataset.comment = newText;
      textDiv.innerHTML = tlMetaHTML(newText, time, textDiv._savedAuthor || _authorName());
      const cardText = entry.closest('.task')?.querySelector('p')?.textContent.slice(0, 40) || 'Card';
      logActivity('edit', `<b>${escapeHTML(_authorName())}</b> edited a comment on "<em>${escapeHTML(cardText)}</em>"<br><span class='activity-diff'><s>${escapeHTML(oldText.slice(0, 60))}${oldText.length > 60 ? '…' : ''}</s> → ${escapeHTML(newText.slice(0, 60))}${newText.length > 60 ? '…' : ''}</span>`);
      saveTask(entry.closest('.task'));
      return;
    }
  });

  // ── Update button / comment box ──────────────────────────────────────────
  board.addEventListener('click', e => {
    if (e.target.closest('.task__cc-cancel')) {
      const task = e.target.closest('.task');
      task.querySelector('.task__comment-input').value = '';
      setCardExpanded(task, false);
      return;
    }
    if (e.target.closest('.task__cc-submit')) {
      const task    = e.target.closest('.task');
      const box     = task.querySelector('.task__comment-box');
      const input   = box.querySelector('.task__comment-input');
      const comment = input.value.trim();
      if (!comment) { input.focus(); return; }

      const _now    = Date.now();
      const today   = fmtDate(_now);
      const entry = document.createElement('div');
      entry.className = 'task__tl-entry';
      entry.dataset.ts = _now;
      entry.dataset.authorUid = currentUser?.uid || '';
      entry.innerHTML = `<span class='task__tl-dot task__tl-dot--comment'>${_authorAvatar()}</span>
        <div class='task__tl-text' data-comment="${escapeHTML(comment)}">${escapeHTML(comment)}<div class='task__tl-meta'><time>${escapeHTML(today)}</time><b>${escapeHTML(_authorName())}</b></div></div>`;

      let tl = task.querySelector('.task__timeline');
      if (!tl) {
        task.querySelector('.task__footer').insertAdjacentHTML('beforebegin', `<div class='task__timeline'></div>`);
        tl = task.querySelector('.task__timeline');
      }
      const moreEl = tl.querySelector('.task__tl-more');
      moreEl ? tl.insertBefore(entry, moreEl) : tl.appendChild(entry);

      const countEl = task.querySelector('.task__stats .fa-comment');
      if (countEl) {
        const span = countEl.parentElement;
        const n    = parseInt(span.textContent) || 0;
        span.innerHTML = `<i class='fas fa-comment'></i>${n + 1}`;
      }

      setCardExpanded(task, true);
      input.value = '';
      box.classList.remove('open');
      const cardText = task.querySelector('p')?.textContent.slice(0, 40) || 'Card';
      logActivity('comment', `<b>${escapeHTML(_authorName())}</b> commented on "<b>${escapeHTML(cardText)}</b>": ${escapeHTML(comment.slice(0, 80))}${comment.length > 80 ? '…' : ''}`);
      saveChanges();
      return;
    }
  });

  // ── Column rename helper ─────────────────────────────────────────────────
  function startColRename(titleEl) {
    if (titleEl.querySelector('input')) return; // already editing
    const current = titleEl.textContent;
    titleEl.innerHTML = '';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'col-rename-input'; inp.value = current;
    titleEl.appendChild(inp);
    inp.focus(); inp.select();
    function commitRename() {
      const val = inp.value.trim() || current;
      titleEl.textContent = val;
      saveChanges();
    }
    inp.addEventListener('blur', commitRename);
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter')  { ev.stopPropagation(); inp.blur(); }
      if (ev.key === 'Escape') { ev.stopPropagation(); inp.value = current; inp.blur(); }
    });
  }

  // ── Column heading dropdown ──────────────────────────────────────────────
  let openColDropdown = null;
  document.addEventListener('click', e => {
    if (openColDropdown && !openColDropdown.contains(e.target) && !e.target.closest('.project-column-heading__options')) {
      openColDropdown.classList.remove('open');
      openColDropdown = null;
    }
  });

  board.addEventListener('click', e => {
    // Click on heading background (not title or options button) → collapse/expand
    // Debounced so double-click can cancel it and trigger rename instead
    if (e.target.closest('.project-column-heading') &&
        !e.target.closest('.project-column-heading__title') &&
        !e.target.closest('.project-column-heading__options') &&
        !e.target.closest('.col-collapse-btn') &&
        !e.target.closest('.col-dropdown') &&
        !e.target.closest('.col-resize-handle') &&
        !e.target.closest('.col-drag-handle')) {
      e.stopPropagation();
      const colEl = e.target.closest('.project-column');
      if (colEl) {
        if (colEl._colClickTimer) { clearTimeout(colEl._colClickTimer); colEl._colClickTimer = null; }
        colEl._colClickTimer = setTimeout(() => {
          colEl._colClickTimer = null;
          // Guard: column may have been moved to the bar by the time timer fires
          if (document.contains(colEl)) toggleColCollapse(colEl);
        }, 250);
      }
      return;
    }
    // Collapse button
    if (e.target.closest('.col-collapse-btn')) {
      e.stopPropagation();
      const colEl = e.target.closest('.project-column');
      if (colEl) toggleColCollapse(colEl);
      return;
    }
    // Toggle dropdown
    if (e.target.closest('.project-column-heading__options')) {
      e.stopPropagation();
      const colEl  = e.target.closest('.project-column');
      const dd     = colEl.querySelector('.col-dropdown');
      if (!dd) return;
      const isOpen = dd.classList.contains('open');
      if (openColDropdown && openColDropdown !== dd) openColDropdown.classList.remove('open');
      dd.classList.toggle('open', !isOpen);
      openColDropdown = !isOpen ? dd : null;
      return;
    }
    // Collapse / expand column
    if (e.target.closest('.col-opt-collapse')) {
      const colEl = e.target.closest('.project-column');
      colEl.querySelector('.col-dropdown').classList.remove('open'); openColDropdown = null;
      toggleColCollapse(colEl);
      return;
    }
    // Rename column
    if (e.target.closest('.col-opt-rename')) {
      if (window._boardRole === 'member') { showToast('Contact an admin to make changes to columns.', true); return; }
      const colEl   = e.target.closest('.project-column');
      if (colEl.classList.contains('project-column--archive') || colEl.classList.contains('project-column--trash')) return;
      const dd      = colEl.querySelector('.col-dropdown');
      const titleEl = colEl.querySelector('.project-column-heading__title');
      dd.classList.remove('open'); openColDropdown = null;
      startColRename(titleEl);
      return;
    }
    // Add column before
    if (e.target.closest('.col-opt-add-before')) {
      if (window._boardRole === 'member') { showToast('Contact an admin to make changes to columns.', true); return; }
      const colEl = e.target.closest('.project-column');
      if (colEl.classList.contains('project-column--archive') || colEl.classList.contains('project-column--trash')) return;
      colEl.querySelector('.col-dropdown').classList.remove('open'); openColDropdown = null;
      const newCol = document.createElement('div');
      newCol.className = 'project-column';
      newCol.dataset.columnId = nextColId++;
      newCol.innerHTML = `<div class='project-column-heading'><h2 class='project-column-heading__title'>New Column</h2><button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button></div>`;
      colEl.parentNode.insertBefore(newCol, colEl);
      setupColDropdown(newCol);
      // Re-number colOrder for all regular columns in DOM order
      [...board.querySelectorAll('.project-column:not(.project-column--archive):not(.project-column--trash)')].forEach((c, i) => { c.dataset.colOrder = i; });
      nextColOrder = board.querySelectorAll('.project-column').length;
      syncGrid();
      saveChanges();
      if (window._refreshColCombo) window._refreshColCombo([...document.querySelectorAll('.project-column')].indexOf(newCol));
      return;
    }
    // Add column after
    if (e.target.closest('.col-opt-add-after')) {
      if (window._boardRole === 'member') { showToast('Contact an admin to make changes to columns.', true); return; }
      const colEl = e.target.closest('.project-column');
      if (colEl.classList.contains('project-column--archive') || colEl.classList.contains('project-column--trash')) return;
      colEl.querySelector('.col-dropdown').classList.remove('open'); openColDropdown = null;
      const newCol = document.createElement('div');
      newCol.className = 'project-column';
      newCol.dataset.columnId = nextColId++;
      newCol.innerHTML = `<div class='project-column-heading'><h2 class='project-column-heading__title'>New Column</h2><button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button></div>`;
      colEl.parentNode.insertBefore(newCol, colEl.nextSibling);
      setupColDropdown(newCol);
      // Re-number colOrder for all regular columns in DOM order
      [...board.querySelectorAll('.project-column:not(.project-column--archive):not(.project-column--trash)')].forEach((c, i) => { c.dataset.colOrder = i; });
      nextColOrder = board.querySelectorAll('.project-column').length;
      syncGrid();
      saveChanges();
      if (window._refreshColCombo) window._refreshColCombo([...document.querySelectorAll('.project-column')].indexOf(newCol));
      return;
    }
    // Set WIP limit
    if (e.target.closest('.col-opt-wip')) {
      if (window._boardRole === 'member') { showToast('Contact an admin to make changes to columns.', true); return; }
      const colEl = e.target.closest('.project-column');
      colEl.querySelector('.col-dropdown').classList.remove('open'); openColDropdown = null;
      const current = colEl.dataset.wipLimit || '';
      Swal.fire({
        title: 'Set WIP Limit',
        text: 'Max cards allowed in this column (0 = no limit):',
        input: 'number',
        inputValue: current,
        inputAttributes: { min: 0, max: 99, step: 1 },
        showCancelButton: true,
        confirmButtonText: 'Save',
        cancelButtonText: 'Cancel',
        reverseButtons: true
      }).then(result => {
        if (!result.isConfirmed) return;
        const val = parseInt(result.value) || 0;
        if (val > 0) colEl.dataset.wipLimit = val;
        else delete colEl.dataset.wipLimit;
        refreshColCount(colEl);
        saveChanges(true);
      });
      return;
    }
    // Delete column
    if (e.target.closest('.col-opt-empty-trash')) {
      const colEl = e.target.closest('.project-column');
      colEl.querySelector('.col-dropdown').classList.remove('open'); openColDropdown = null;
      const count = colEl.querySelectorAll(':scope > .task').length;
      if (!count) { showToast('Trash is already empty.'); return; }
      Swal.fire({
        title: 'Empty Trash?',
        text: `${count} card${count !== 1 ? 's' : ''} will be permanently deleted and cannot be recovered.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Empty Trash',
        confirmButtonColor: '#e05252',
        cancelButtonText: 'Cancel',
        reverseButtons: true
      }).then(result => {
        if (!result.isConfirmed) return;
        const batch = db.batch();
        [...colEl.querySelectorAll(':scope > .task')].forEach(card => {
          const tid = card.dataset.id;
          if (tid) batch.delete(db.collection(`boards/${BOARD_ID}/tasks`).doc(tid));
          card.remove();
        });
        batch.commit().catch(err => console.error('Empty trash failed:', err));
        refreshAllColCounts();
        _refreshTrashBadge();
        saveChanges(true);
        logActivity('delete', `<b>${_authorName()}</b> emptied the Trash (${count} card${count !== 1 ? 's' : ''})`);
        showToast('Trash emptied');
      });
      return;
    }

    if (e.target.closest('.col-opt-delete')) {
      if (window._boardRole === 'member') { showToast('Contact an admin to make changes to columns.', true); return; }
      const colEl    = e.target.closest('.project-column');
      colEl.querySelector('.col-dropdown').classList.remove('open'); openColDropdown = null;
      const taskCount = colEl.querySelectorAll(':scope > .task').length;
      if (taskCount > 0) {
        Swal.fire({ title: 'Column not empty', text: `Move or delete the ${taskCount} card${taskCount > 1 ? 's' : ''} before deleting this column.`, icon: 'warning', confirmButtonColor: '#e05252' });
        return;
      }
      const colTitle = colEl.querySelector('.project-column-heading__title')?.textContent || 'this column';
      Swal.fire({
        title: 'Are you sure?',
        text: `"${colTitle}" will be permanently deleted.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Delete',
        confirmButtonColor: '#e05252',
        cancelButtonText: 'Cancel',
        reverseButtons: true
      }).then(result => {
        if (!result.isConfirmed) return;
        colEl.remove();
        syncGrid();
        saveChanges();
      });
      return;
    }
  });

  // ── Double-click column title to rename ───────────────────────────────────
  // Also handles double-click on the heading background (non-title) → rename
  board.addEventListener('dblclick', e => {
    const heading = e.target.closest('.project-column-heading');
    if (!heading) return;
    const colEl = heading.closest('.project-column');
    if (!colEl || colEl.classList.contains('project-column--archive') || colEl.classList.contains('project-column--trash')) return;
    e.preventDefault();
    // Cancel any pending single-click collapse for this column
    if (colEl._colClickTimer) { clearTimeout(colEl._colClickTimer); colEl._colClickTimer = null; }
    // Rename: resolve to the title element whether user clicked title or background
    const titleEl = heading.querySelector('.project-column-heading__title');
    if (!titleEl) return;
    if (openColDropdown) { openColDropdown.classList.remove('open'); openColDropdown = null; }
    startColRename(titleEl);
  });
  // Todo checkbox toggle
  board.addEventListener('change', e => {
    const cb = e.target.closest('.task__todo-cb');
    if (!cb) return;
    const span = cb.nextElementSibling;
    if (span) span.classList.toggle('task__todo-text--done', cb.checked);
    const todoText  = span?.textContent?.trim().slice(0, 50) || 'item';
    const cardText  = cb.closest('.task')?.querySelector('p')?.textContent.slice(0, 40) || 'Card';
    logActivity('todo', `<b>${_authorName()}</b> ${cb.checked ? 'completed' : 'unchecked'} "${todoText}" on <em>${cardText}</em>`);
    const todosWrap = cb.closest('.task__todos');
    if (todosWrap) {
      const all  = [...todosWrap.querySelectorAll('.task__todo-cb')];
      const done = all.filter(c => c.checked).length;
      const pct  = all.length ? Math.round(done / all.length * 100) : 0;
      const bar  = todosWrap.querySelector('.task__todos-bar-fill');
      const lbl  = todosWrap.querySelector('.task__todos-progress span');
      if (bar) bar.style.width = pct + '%';
      if (lbl) lbl.textContent = done + '/' + all.length;
    }
    saveTask(cb.closest('.task'), true);
  });


  // ── Archive toggle ───────────────────────────────────────────────────────
  document.getElementById('archiveBtn')?.addEventListener('click', function () {
    board.classList.toggle('show-archive');
    this.classList.toggle('active');
    syncGrid();
  });

  // ── Trash toggle ─────────────────────────────────────────────────────────
  document.getElementById('trashBtn')?.addEventListener('click', function () {
    board.classList.toggle('show-trash');
    this.classList.toggle('active');
    syncGrid();
    _refreshTrashBadge();
  });

  // ── Trash badge helper ───────────────────────────────────────────────────
  function _refreshTrashBadge() {
    const btn = document.getElementById('trashBtn');
    if (!btn) return;
    const trashCol = document.querySelector('.project-column--trash');
    const count = trashCol ? trashCol.querySelectorAll(':scope > .task').length : 0;
    let badge = btn.querySelector('.trash-badge');
    if (count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'trash-badge'; btn.appendChild(badge); }
      badge.textContent = count > 99 ? '99+' : count;
    } else {
      badge?.remove();
    }
  }

  // Refresh badge whenever cards enter/leave the trash column
  new MutationObserver(() => _refreshTrashBadge()).observe(
    document.querySelector('.project-tasks'),
    { childList: true, subtree: true }
  );

  // ── Topbar user dropdown ─────────────────────────────────────────────────
  const topbarUser    = document.getElementById('topbarUser');
  const topbarTrigger = document.getElementById('topbarUserTrigger');
  topbarTrigger.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = !topbarUser.classList.contains('open');
    closeAllPopups(['topbarUser']);
    topbarUser.classList.toggle('open', willOpen);
  });
  document.addEventListener('click', e => {
    if (!topbarUser.contains(e.target)) topbarUser.classList.remove('open');
  });

  // ── Settings ─────────────────────────────────────────────────────────────
  document.getElementById('settingsBtn')?.addEventListener('click', () => {
    topbarUser.classList.remove('open');
    Swal.fire({ title: 'Settings', text: 'Settings panel coming soon.', icon: 'info', confirmButtonColor: 'var(--purple)' });
  });

  // ── Profile ───────────────────────────────────────────────────────────────
  document.getElementById('profileBtn')?.addEventListener('click', () => {
    topbarUser.classList.remove('open');
    Swal.fire({ title: 'My Profile', text: 'Profile panel coming soon.', icon: 'info', confirmButtonColor: 'var(--purple)' });
  });

  // ── Per-icon adaptive contrast ───────────────────────────────────────────
  // Each button independently samples the element directly behind it using
  // document.elementsFromPoint(), so icons adapt as content scrolls under them.
  (function () {
    const navBar = document.querySelector('.project-info');
    if (!navBar) return;

    // Walk the DOM upward from `el` to find the first solid background color.
    function getEffectiveBg(el) {
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = window.getComputedStyle(node).backgroundColor;
        const m  = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (m) {
          const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
          if (alpha > 0.1) return { r: +m[1], g: +m[2], b: +m[3] };
        }
        node = node.parentElement;
      }
      return null;
    }

    // WCAG relative luminance (0 = black, 1 = white).
    function luminance(r, g, b) {
      const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }

    // Return the luminance of the content visually behind `btn`.
    function luminanceBehind(btn) {
      const rect = btn.getBoundingClientRect();
      const cx   = Math.round(rect.left + rect.width  / 2);
      const cy   = Math.round(rect.top  + rect.height / 2);

      // elementsFromPoint returns all stacked elements; skip the nav bar itself.
      const all    = document.elementsFromPoint(cx, cy);
      const behind = all.find(el => el !== navBar && !navBar.contains(el));

      if (!behind || behind === document.documentElement || behind === document.body) {
        // No board content at this point — fall back to bg-is-dark metadata.
        return document.body.classList.contains('bg-is-dark') ? 0.05 : 0.95;
      }

      const bg = getEffectiveBg(behind);
      if (!bg) {
        // Transparent all the way up — fall back to bg-is-dark metadata.
        return document.body.classList.contains('bg-is-dark') ? 0.05 : 0.95;
      }

      return luminance(bg.r, bg.g, bg.b);
    }

    // Selectors for all adaptable icon elements inside the nav bar.
    const ICON_SEL = [
      '.topbar-icon-btn:not(.topbar-icon-btn--add)',
      '.topbar-search__icon-btn',
      '.topbar-search__filter',
      '.tags-btn',
      '.nav-toggle',
      '.topbar-user__trigger',
      '#boardOptionsBtn',
      '.collapsed-bar .project-column--collapsed',
    ].join(',');

    let _rafId = null;
    function updateContrast() {
      if (_rafId) return;
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        navBar.querySelectorAll(ICON_SEL).forEach(btn => {
          const lum    = luminanceBehind(btn);
          const isDark = lum < 0.35;   // background is dark → use light icons
          btn.classList.toggle('icon--on-dark',  isDark);
          btn.classList.toggle('icon--on-light', !isDark);
        });
      });
    }

    // Trigger on scroll (window and any inner scroll containers).
    window.addEventListener('scroll', updateContrast, { passive: true });
    window.addEventListener('resize', updateContrast, { passive: true });
    document.querySelector('.project-tasks')
      ?.addEventListener('scroll', updateContrast, { passive: true });

    // Re-run whenever the board background is applied (gradient / image / cleared).
    const _origApplyBg = window._applyBoardBackground;
    if (_origApplyBg) {
      window._applyBoardBackground = function (bg) {
        _origApplyBg.call(this, bg);
        setTimeout(updateContrast, 60);
      };
    }

    // Initial pass after everything has painted.
    setTimeout(updateContrast, 150);

    // Expose so other modules (e.g. board load) can trigger a refresh.
    window._updateIconContrast = updateContrast;
  })();

}); // end DOMContentLoaded
