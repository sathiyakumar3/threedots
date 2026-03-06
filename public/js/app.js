// ── EmailJS configuration ─────────────────────────────────────────────────
// Sign up at https://www.emailjs.com, create a service + template, then fill in:
window.EMAILJS_CONFIG = {
  serviceId:  'YOUR_SERVICE_ID',   // e.g. 'service_abc123'
  templateId: 'YOUR_TEMPLATE_ID',  // e.g. 'template_xyz789'
  publicKey:  'YOUR_PUBLIC_KEY'    // EmailJS dashboard → Account → API Keys
};
// Template variables expected: {{to_email}}, {{board_name}}, {{invited_by}}, {{invite_link}}

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
  const loginOverlay = document.getElementById('loginOverlay');
  const appShell     = document.getElementById('appShell');
  const btnGoogle    = document.getElementById('btnGoogleSignIn');
  const loginError   = document.getElementById('loginError');

  function setLoginError(msg) { loginError.textContent = msg; }
  function clearLoginError()  { loginError.textContent = ''; }

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
      avatarEl.innerHTML = `<img src='${user.photoURL}' alt='avatar'>`;
      if (avatarDropEl) avatarDropEl.innerHTML = `<img src='${user.photoURL}' alt='avatar'>`;
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
  auth.onAuthStateChanged(user => { if (user) showApp(user); else hideApp(); });

  // ── Google sign-in ──
  btnGoogle.addEventListener('click', () => {
    clearLoginError();
    auth.signInWithPopup(googleProvider).catch(err => setLoginError(err.message));
  });

  // ── Microsoft sign-in ──
  document.getElementById('btnMicrosoftSignIn').addEventListener('click', () => {
    clearLoginError();
    auth.signInWithPopup(microsoftProvider).catch(err => setLoginError(err.message));
  });

  // ── Email / password sign-in ──
  document.getElementById('btnEmailSignIn').addEventListener('click', () => {
    clearLoginError();
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { setLoginError('Please enter your email and password.'); return; }
    auth.signInWithEmailAndPassword(email, password)
      .catch(err => setLoginError(err.message));
  });
  document.getElementById('loginFormEl').addEventListener('submit', () =>
    document.getElementById('btnEmailSignIn').click()
  );

  // ── Email / password register ──
  document.getElementById('btnRegister').addEventListener('click', () => {
    clearLoginError();
    const email    = document.getElementById('regEmail').value.trim();
    const name     = document.getElementById('regDisplayName').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm  = document.getElementById('regPasswordConfirm').value;
    if (!email || !password) { setLoginError('Please fill in all fields.'); return; }
    if (password.length < 6) { setLoginError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setLoginError('Passwords do not match.'); return; }
    auth.createUserWithEmailAndPassword(email, password)
      .then(cred => {
        if (name) return cred.user.updateProfile({ displayName: name });
      })
      .then(() => auth.currentUser.reload())
      .catch(err => setLoginError(err.message));
  });
  document.getElementById('registerFormEl').addEventListener('submit', () =>
    document.getElementById('btnRegister').click()
  );

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

  document.getElementById('logoutBtn').addEventListener('click', () => {
    document.getElementById('topbarUser')?.classList.remove('open');
    auth.signOut();
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
      db.doc(`boards/${BOARD_ID}`)
        .update({ activity: [] })
        .then(() => {
          window._activityCache = [];
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
        selectedTheme: document.body.classList.contains('dark') ? 'dark' : 'light',
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
    themeBtn.innerHTML = dark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    themeBtn.classList.toggle('active', dark);
    if (window.Coloris) Coloris({ themeMode: dark ? 'dark' : 'light' });
    if (_activityCalendar) {
      _activityCalendar.context.selectedTheme = dark ? 'dark' : 'light';
      _activityCalendar.update({ dates: true });
    }
  }
  applyTheme(localStorage.getItem('theme') === 'dark');
  themeBtn.addEventListener('click', () => {
    const isDark = !document.body.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    applyTheme(isDark);
  });

  const board   = document.querySelector('.project-tasks');
  let userFavouriteBoard = null;

  // ── Column task-count badge helpers ─────────────────────────────────────
  function refreshColCount(colEl) {
    const count = colEl.querySelectorAll(':scope > .task').length;
    const badge = colEl.querySelector('.col-count');
    if (badge) badge.textContent = count;
  }
  function refreshAllColCounts() {
    document.querySelectorAll('.project-column').forEach(refreshColCount);
  }
  // Auto-refresh: only react to .task cards being added/removed inside columns
  new MutationObserver(mutations => {
    if (mutations.some(m => [...m.addedNodes, ...m.removedNodes].some(n => n.classList?.contains('task')))) {
      refreshAllColCounts();
    }
  }).observe(board, { childList: true, subtree: true });

  // ── Author identity helpers ──────────────────────────────────────────────
  function _authorName()  { return currentUser?.displayName || currentUser?.email || 'You'; }
  function _authorPhoto() { return currentUser?.photoURL    || ''; }
  function _authorAvatar() {
    const name  = _authorName();
    const photo = _authorPhoto();
    return photo
      ? `<img class='tl-avatar' src='${photo}' alt='${name}' title='${name}'>`
      : `<span class='tl-avatar tl-avatar--initial' title='${name}'>${name[0].toUpperCase()}</span>`;
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
  function loadBoard(id) {
    BOARD_ID = id;
    board.innerHTML = '';
    document.getElementById('activityFeed').innerHTML = '';
    // ── Set up Firestore activity persistence hook ──
    window._activityCache = [];
    window._persistActivity = (type, text, date, ts) => {
      window._activityCache.push({ type, text, date, ts });
      if (window._activityCache.length > 50)
        window._activityCache.splice(0, window._activityCache.length - 50);
      db.doc(`boards/${BOARD_ID}`)
        .update({ activity: window._activityCache })
        .catch(err => console.error('Activity persist error:', err));
    };
    const srch = document.getElementById('boardSearch');
    if (srch) { srch.value = ''; searchClear.classList.remove('visible'); }
    // Highlight active item in combo
    document.getElementById('boardComboMenu').querySelectorAll('.board-combo__item')
      .forEach(b => b.classList.toggle('active', b.dataset.boardId === id));
    // Reset archive button + show-archive state
    board.classList.remove('show-archive');
    document.getElementById('archiveBtn').classList.remove('active');
    // Close board options dropdown if open
    document.getElementById('boardDropdown').classList.remove('open');
    // Reset activity panel to collapsed
    const actPanel = document.getElementById('activityPanel');
    const actToggle = document.getElementById('activityToggle');
    if (actPanel)  actPanel.classList.add('collapsed');
    if (actToggle) { actToggle.classList.remove('active'); actToggle.title = 'Show activity'; }

    db.doc(`boards/${id}`).get()
      .then(snap => {
        if (snap.exists) {
          const data = snap.data();
          const name = data.name || 'Board';
          const menu = document.getElementById('boardComboMenu');
          const item = menu.querySelector(`[data-board-id="${id}"]`);
          if (item) { item.textContent = name; }
          document.getElementById('boardComboLabel').textContent = name;
          if (data.tags && window._applyBoardTags) window._applyBoardTags(data.tags);
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
              // Load tasks from subcollection boards/{id}/tasks
              db.collection(`boards/${id}/tasks`)
                .get()
                .then(snap => {
                  if (!snap.empty) {
                    const tasks = snap.docs
                      .map(d => d.data())
                      .sort((a, b) => (a.order || 0) - (b.order || 0));
                    buildTasksFromFlatData(tasks);
                  } else if (Array.isArray(data.tasks) && data.tasks.length > 0) {
                    // Migration: old boards stored task IDs in board doc, tasks in top-level collection
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
                    // Legacy format: tasks is an object with a `columns` array (full task bodies)
                    buildTasksFromData(data.tasks);
                  }
                })
                .catch(err => console.error('Could not load tasks:', err));
            }
            renderParticipants(_adminUids, _boardUsers);
            // ── Load persisted activity feed ──
            const storedActivity = data.activity || [];
            window._activityCache = [...storedActivity];
            storedActivity.forEach(a => {
              logActivity(a.type, a.text, a.date, a.ts, true /* skipPersist */);
            });
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
    const addBtn = document.getElementById('addParticipantBtn');

    const makeAvatar = (uid, isAdmin) => {
      const cached = (window._uidMap && window._uidMap[uid]) || {};
      const name   = cached.name  || uid;
      const photo  = cached.photo || '';
      const av     = document.createElement('div');
      av.className = 'participant-avatar' + (isAdmin ? ' participant-avatar--admin' : '');
      av.dataset.uid = uid;
      const inner = photo
        ? `<img src='${photo}' alt='${name}'>`
        : `<span>${name[0].toUpperCase()}</span>`;
      const crown = isAdmin ? `<span class='pa-crown'><i class='fas fa-crown'></i></span>` : '';
      const roleClass = isAdmin ? 'pcard__title--admin' : 'pcard__title--member';
      const roleLabel = isAdmin ? '<i class="fas fa-shield-alt"></i> Admin' : '<i class="fas fa-user"></i> Member';
      av.innerHTML = `${inner}${crown}
        <div class='participant-card'>
          <div class='pcard__title ${roleClass}'>${roleLabel}</div>
          <div class='pcard__info'>
            <div class='pcard__row'><div class='pcard__name'>${name}</div></div>
            <div class='pcard__row'><div class='pcard__email'>${cached.email || ''}</div></div>
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
      return `<div class='team-member-row' data-uid='${uid}'>
        <div class='team-member-row__avatar'>${avatarHTML}</div>
        <div class='team-member-row__info'>
          <div class='team-member-row__name'>${name}</div>
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
    db.doc(`boards/${BOARD_ID}`).get().then(snap => {
      if (!snap.exists) return;
      const bd         = snap.data();
      const admins     = bd.users?.admins     || (bd.admins ? bd.admins : (bd.owner ? [bd.owner] : []));
      const members    = bd.users?.members    || [];
      const nonMembers = bd.users?.nonMembers || [];
      renderTeamPanel(admins, members, nonMembers, e.target.value.trim());
    });
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
            const invitedByName = currentUser?.displayName || currentUser?.email || 'A team member';
            const appUrl        = window.location.origin + window.location.pathname;
            const inviteLink    = `${appUrl}?invite=${encodeURIComponent(email)}&board=${encodeURIComponent(BOARD_ID)}&bname=${encodeURIComponent(boardName)}`;
            const newNonMembers = [...nonMembers, email];
            const batch = db.batch();
            batch.update(db.doc(`boards/${BOARD_ID}`), { 'users.nonMembers': newNonMembers });
            const invRef = db.collection('invitations').doc();
            batch.set(invRef, {
              email,
              boardId:       BOARD_ID,
              boardName,
              invitedBy:     currentUser.uid,
              invitedByName,
              invitedAt:     firebase.firestore.FieldValue.serverTimestamp(),
              status:        'pending'
            });
            batch.commit().then(() => {
              sendInvitationEmail({ email, boardName, invitedByName, inviteLink });
              window._pendingEmails = newNonMembers;
              participantMsg.className = 'team-panel__msg ok';
              participantMsg.textContent = `Invitation sent to ${email}`;
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
      columns: { columns: [
        { id: 1,  title: 'To Do'       },
        { id: 2,  title: 'In Progress' },
        { id: 3,  title: 'Review'      },
        { id: 98, title: 'Done'        },
        { id: 99, title: 'Archive', archive: true }
      ]}
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
        loadBoard(docRef.id);
        return docRef;
      })
      .catch(err => { console.error('Create board failed:', err); showToast('Could not create board', true); });
  }

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  function clearHighlights() {
    document.querySelectorAll('.task-hover').forEach(t => t.classList.remove('task-hover'));
    document.querySelectorAll('.column-drag-over').forEach(c => c.classList.remove('column-drag-over'));
  }

  board.addEventListener('dragstart', e => {
    const task = e.target.closest('.task');
    if (!task) return;
    if (openColDropdown) { openColDropdown.classList.remove('open'); openColDropdown = null; }
    if (openDropdown)    { openDropdown.classList.remove('open');    openDropdown    = null; }
    dragSrcEl = task;
    setTimeout(() => { task.style.opacity = '0.4'; }, 0);
    e.dataTransfer.effectAllowed = 'move';
  });

  board.addEventListener('dragend', () => {
    if (dragSrcEl) dragSrcEl.style.opacity = '1';
    clearHighlights();
    dragSrcEl = null;
  });

  board.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearHighlights();
    const task = e.target.closest('.task');
    if (task && task !== dragSrcEl) {
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
    if (!dragSrcEl) return;
    const task    = e.target.closest('.task');
    const col     = e.target.closest('.project-column');
    const colName = col ? col.querySelector('.project-column-heading__title')?.textContent : '';
    const cardText = dragSrcEl.querySelector('p')?.textContent.slice(0, 40) || 'Card';

    if (task && task !== dragSrcEl) {
      task.parentNode.insertBefore(dragSrcEl, task);
    } else if (col) {
      col.appendChild(dragSrcEl);
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

    // ── Single-document drag save (fractional order) ──
    const taskId    = dragSrcEl.dataset.id;
    const newColId  = col ? +col.dataset.columnId : null;
    if (taskId && newColId !== null) {
      const siblings = [...col.querySelectorAll(':scope > .task')];
      const idx      = siblings.indexOf(dragSrcEl);
      const prevOrder = idx > 0                    ? parseFloat(siblings[idx - 1].dataset.order ?? (idx - 1)) : null;
      const nextOrder = idx < siblings.length - 1  ? parseFloat(siblings[idx + 1].dataset.order ?? (idx + 1)) : null;
      let newOrder;
      if      (prevOrder === null && nextOrder === null) newOrder = 0;
      else if (prevOrder === null) newOrder = nextOrder - 1;
      else if (nextOrder === null) newOrder = prevOrder + 1;
      else                         newOrder = (prevOrder + nextOrder) / 2;
      dragSrcEl.dataset.order = newOrder;
      db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId)
        .update({ columnId: newColId, order: newOrder })
        .catch(err => console.error('Drag save failed:', err));
    }
    dragSrcEl = null;
  });

  // ── Build board from Firestore data ─────────────────────────────────────
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

  function buildColumnsFromData(colData) {
    let maxId = 0;
    colData.columns.forEach(col => {
      const div       = document.createElement('div');
      div.className   = 'project-column' + (col.archive ? ' project-column--archive' : '');
      div.dataset.columnId = col.id;
      if (col.owner) div.dataset.owner = col.owner;
      if (col.users && col.users.length) div.dataset.users = JSON.stringify(col.users);
      div.innerHTML   = `<div class='project-column-heading'>
        <h2 class='project-column-heading__title'>${col.title}</h2>
        <span class='col-count'>0</span>
        <button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button>
      </div>`;
      board.appendChild(div);
      setupColDropdown(div);
      if (!col.archive && col.id < 97 && col.id > maxId) maxId = col.id;
    });
    nextColId = maxId + 1;
    syncGrid();
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
    tasks.forEach(taskData => {
      const colEl = colEls.find(c => +c.dataset.columnId === taskData.columnId)
                 || colEls[0];
      if (colEl) colEl.appendChild(renderCard(taskData));
    });
    refreshAllColCounts();
  }

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
    if (task.classList.contains('task--expanded') && e.target.closest('.task__tl-text')) return;
    // Close any open timeline edit inputs across the whole board before toggling
    board.querySelectorAll('.task__tl-entry--editing').forEach(entry => {
      entry.classList.remove('task__tl-entry--editing');
      const textDiv = entry.querySelector('.task__tl-text');
      if (!textDiv) return;
      const t = textDiv._savedTime || '';
      textDiv.innerHTML = tlMetaHTML(textDiv.dataset.comment || '', t, textDiv._savedAuthor || '');
    });
    task.classList.toggle('task--expanded');
    refreshExpandBtn(task);
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
    // Edit — open modal
    if (e.target.closest('.task__opt-edit')) {
      const task = e.target.closest('.task');
      task.querySelector('.task__dropdown').classList.remove('open');
      openDropdown = null;
      if (window._boardRole === 'member' && task.dataset.createdByUid && task.dataset.createdByUid !== currentUser?.uid) {
        showToast('You can only edit your own tasks.', true);
        return;
      }
      if (window._openEditModal) window._openEditModal(task);
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
      Swal.fire({
        title: 'Are you sure?',
        text: 'This task will be permanently deleted.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Delete',
        confirmButtonColor: '#e05252',
        cancelButtonText: 'Cancel',
        reverseButtons: true
      }).then(result => {
        if (!result.isConfirmed) return;
        task.style.transition = 'opacity .2s';
        task.style.opacity    = '0';
        // Remove task doc from subcollection, then save board
        const deleteDoc = taskId
          ? db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId).delete().catch(err => console.warn('Could not delete task doc:', err))
          : Promise.resolve();
        setTimeout(() => {
          task.remove();
          deleteDoc.then(() => saveChanges(true));
        }, 200);
        logActivity('delete', `<b>${_authorName()}</b> deleted "${cardText}"`);
        openDropdown = null;
      });
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
      logActivity('edit', `<b>${_authorName()}</b> edited a comment on "<em>${cardText}</em>"<br><span class='activity-diff'><s>${oldText.slice(0, 60)}${oldText.length > 60 ? '…' : ''}</s> → ${newText.slice(0, 60)}${newText.length > 60 ? '…' : ''}</span>`);
      saveTask(entry.closest('.task'));
      return;
    }
  });

  // ── Update button / comment box ──────────────────────────────────────────
  board.addEventListener('click', e => {
    if (e.target.closest('.task__cc-cancel')) {
      const task = e.target.closest('.task');
      task.querySelector('.task__comment-input').value = '';
      task.classList.remove('task--expanded');
      refreshExpandBtn(task);
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
        <div class='task__tl-text' data-comment="${comment.replace(/"/g, '&quot;')}">${comment}<div class='task__tl-meta'><time>${today}</time><b>${_authorName()}</b></div></div>`;

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

      task.classList.add('task--expanded');
      refreshExpandBtn(task);
      input.value = '';
      box.classList.remove('open');
      const cardText = task.querySelector('p')?.textContent.slice(0, 40) || 'Card';
      logActivity('comment', `<b>${_authorName()}</b> commented on "<b>${cardText}</b>": ${comment.slice(0, 80)}${comment.length > 80 ? '�' : ''}`);
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
      if (ev.key === 'Enter')  inp.blur();
      if (ev.key === 'Escape') { inp.value = current; inp.blur(); }
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
    // Rename column
    if (e.target.closest('.col-opt-rename')) {
      if (window._boardRole === 'member') { showToast('Contact an admin to make changes to columns.', true); return; }
      const colEl   = e.target.closest('.project-column');
      if (colEl.classList.contains('project-column--archive')) return;
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
      if (colEl.classList.contains('project-column--archive')) return;
      colEl.querySelector('.col-dropdown').classList.remove('open'); openColDropdown = null;
      const newCol = document.createElement('div');
      newCol.className = 'project-column';
      newCol.dataset.columnId = nextColId++;
      if (currentUser) {
        newCol.dataset.owner = currentUser.uid;
        newCol.dataset.users = JSON.stringify([currentUser.uid]);
      }
      newCol.innerHTML = `<div class='project-column-heading'><h2 class='project-column-heading__title'>New Column</h2><button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button></div>`;
      colEl.parentNode.insertBefore(newCol, colEl);
      setupColDropdown(newCol);
      syncGrid();
      saveChanges();
      if (window._refreshColCombo) {
        const idx = [...document.querySelectorAll('.project-column')].indexOf(newCol);
        window._refreshColCombo(idx);
      }
      return;
    }
    // Add column after
    if (e.target.closest('.col-opt-add-after')) {
      if (window._boardRole === 'member') { showToast('Contact an admin to make changes to columns.', true); return; }
      const colEl = e.target.closest('.project-column');
      if (colEl.classList.contains('project-column--archive')) return;
      colEl.querySelector('.col-dropdown').classList.remove('open'); openColDropdown = null;
      const newCol = document.createElement('div');
      newCol.className = 'project-column';
      newCol.dataset.columnId = nextColId++;
      if (currentUser) {
        newCol.dataset.owner = currentUser.uid;
        newCol.dataset.users = JSON.stringify([currentUser.uid]);
      }
      newCol.innerHTML = `<div class='project-column-heading'><h2 class='project-column-heading__title'>New Column</h2><button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button></div>`;
      colEl.parentNode.insertBefore(newCol, colEl.nextSibling);
      setupColDropdown(newCol);
      syncGrid();
      saveChanges();
      if (window._refreshColCombo) {
        const idx = [...document.querySelectorAll('.project-column')].indexOf(newCol);
        window._refreshColCombo(idx);
      }
      return;
    }
    // Delete column
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
  board.addEventListener('dblclick', e => {
    const titleEl = e.target.closest('.project-column-heading__title');
    if (!titleEl) return;
    if (titleEl.closest('.project-column--archive')) return;
    e.preventDefault();
    // Close any open col dropdown
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
  document.getElementById('archiveBtn').addEventListener('click', function () {
    board.classList.toggle('show-archive');
    this.classList.toggle('active');
    syncGrid();
  });

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
  document.getElementById('settingsBtn').addEventListener('click', () => {
    topbarUser.classList.remove('open');
    Swal.fire({ title: 'Settings', text: 'Settings panel coming soon.', icon: 'info', confirmButtonColor: 'var(--purple)' });
  });

  // ── Profile ───────────────────────────────────────────────────────────────
  document.getElementById('profileBtn').addEventListener('click', () => {
    topbarUser.classList.remove('open');
    Swal.fire({ title: 'My Profile', text: 'Profile panel coming soon.', icon: 'info', confirmButtonColor: 'var(--purple)' });
  });

}); // end DOMContentLoaded
