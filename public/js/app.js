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
    // Read user doc first to get favourite, then merge-update lastLogin
    db.collection('users').doc(user.uid).get()
      .then(userSnap => {
        userFavouriteBoard = userSnap.exists ? (userSnap.data().favourite || null) : null;
        db.collection('users').doc(user.uid).set({
          uid:         user.uid,
          displayName: user.displayName || '',
          email:       user.email       || '',
          photoURL:    user.photoURL    || '',
          lastLogin:   firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.error('Error saving user:', err));
        if (window._loadUserTags) window._loadUserTags(user.uid);
        loadUserBoards(user.uid);
      })
      .catch(() => {
        userFavouriteBoard = null;
        if (window._loadUserTags) window._loadUserTags(user.uid);
        loadUserBoards(user.uid);
      });
    document.getElementById('navUserName').textContent  = user.displayName || user.email;
    document.getElementById('navUserEmail').textContent = user.email;
    // Seed photo map with the logged-in user
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
    db.collection('boards').where('users', 'array-contains', uid).get()
      .then(snapshot => {
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

  function applySearch(query) {
    const q = query.trim().toLowerCase();
    document.querySelectorAll('.task').forEach(card => {
      if (!q) {
        card.classList.remove('task--search-hidden', 'task--search-match');
      } else {
        const text  = (card.querySelector('p')?.textContent || '').toLowerCase();
        const tag   = (card.querySelector('.task__tag')?.textContent || '').toLowerCase();
        const match = text.includes(q) || tag.includes(q);
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

  boardSearch.addEventListener('input', () => applySearch(boardSearch.value));
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
  activityToggle.addEventListener('click', () => {
    const collapsed = activityPanel.classList.toggle('collapsed');
    activityToggle.classList.toggle('active', !collapsed);
    activityToggle.title = collapsed ? 'Show activity' : 'Hide activity';
  });

  // ── Dark / light mode toggle ─────────────────────────────────────────────
  const themeBtn = document.getElementById('themeToggleBtn');
  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    themeBtn.innerHTML = dark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
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

  const board   = document.querySelector('.project-tasks');
  let userFavouriteBoard = null;

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
          if (data.columns && data.tasks) {
            buildColumnsFromData(data.columns);
            buildTasksFromData(data.tasks);
          }
          renderParticipants(data.owner || '', data.users || []);
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
  function renderParticipants(ownerUid, userUids) {
    const container = document.getElementById('projectParticipants');
    container.querySelectorAll('.participant-avatar').forEach(el => el.remove());
    const addBtn = document.getElementById('addParticipantBtn');
    const members = userUids.filter(uid => uid !== ownerUid);
    const fetches = members.map(uid =>
      db.collection('users').doc(uid).get().catch(() => null)
    );
    Promise.all(fetches).then(snaps => {
      snaps.forEach(snap => {
        if (!snap || !snap.exists) return;
        const u    = snap.data();
        const uid  = snap.id;
        const name  = u.displayName || u.email || 'User';
        const email = u.email || '';
        const photo = u.photoURL || '';
        // Populate the photo map so avatars resolve correctly
        if (name && photo) {
          window._userPhotoMap = window._userPhotoMap || {};
          window._userPhotoMap[name] = photo;
        }
        const av   = document.createElement('div');
        av.className = 'participant-avatar';
        av.dataset.uid = uid;
        const avatarInner = photo
          ? `<img src='${photo}' alt='${name}'>`
          : `<span>${name[0].toUpperCase()}</span>`;
        av.innerHTML = `${avatarInner}
          <div class='participant-card'>
            <div class='pcard__title'>Participant</div>
            <div class='pcard__info'>
              <div class='pcard__row'><div class='pcard__name'>${name}</div></div>
              <div class='pcard__row'><div class='pcard__email'>${email}</div></div>
            </div>
            <div class='pcard__footer'>
              <button class='pcard__remove' data-uid='${uid}'><i class='fas fa-user-minus'></i> Remove access</button>
            </div>
          </div>`;
        container.insertBefore(av, addBtn);
      });
      // Refresh all card assignee avatars now that photos are known
      if (typeof refreshAllAssigneeAvatars === 'function') refreshAllAssigneeAvatars();
    });
  }

  // Toggle participant card on click, close on outside click
  document.getElementById('projectParticipants').addEventListener('click', e => {
    const btn = e.target.closest('.pcard__remove');
    const av  = e.target.closest('.participant-avatar');
    if (btn) return; // handled by remove listener below
    if (!av) return;
    e.stopPropagation();
    const isOpen = av.classList.contains('open');
    document.querySelectorAll('.participant-avatar.open').forEach(el => el.classList.remove('open'));
    if (!isOpen) av.classList.add('open');
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.participant-avatar.open').forEach(el => el.classList.remove('open'));
  });

  // Remove participant via card
  document.getElementById('projectParticipants').addEventListener('click', e => {
    const btn = e.target.closest('.pcard__remove');
    if (!btn) return;
    e.stopPropagation();
    const uid  = btn.dataset.uid;
    const av   = btn.closest('.participant-avatar');
    const name = av.querySelector('.pcard__name')?.textContent || 'this user';
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
        const newUsers = (snap.data().users || []).filter(u => u !== uid);
        db.doc(`boards/${BOARD_ID}`).update({ users: newUsers }).then(() => {
          av.remove();
        });
      }).catch(() => showToast('Could not remove user', true));
    });
  });

  // ── Add-participant popover ───────────────────────────────────────────────
  const addParticipantBtn    = document.getElementById('addParticipantBtn');
  const participantPopover   = document.getElementById('participantPopover');
  const participantEmail     = document.getElementById('participantEmail');
  const participantMsg       = document.getElementById('participantMsg');
  const participantAddConfirm = document.getElementById('participantAddConfirm');
  const participantAddCancel  = document.getElementById('participantAddCancel');

  function openParticipantPopover() {
    participantEmail.value = '';
    participantMsg.textContent = '';
    participantMsg.className = 'participant-popover__msg';
    participantPopover.classList.add('open');
    participantEmail.focus();
  }
  function closeParticipantPopover() {
    participantPopover.classList.remove('open');
  }

  addParticipantBtn.addEventListener('click', e => {
    e.stopPropagation();
    participantPopover.classList.contains('open') ? closeParticipantPopover() : openParticipantPopover();
  });
  participantAddCancel.addEventListener('click', closeParticipantPopover);
  document.addEventListener('click', e => {
    if (!participantPopover.contains(e.target) && e.target !== addParticipantBtn) {
      closeParticipantPopover();
    }
  });
  participantEmail.addEventListener('keydown', e => {
    if (e.key === 'Enter')  participantAddConfirm.click();
    if (e.key === 'Escape') closeParticipantPopover();
  });

  participantAddConfirm.addEventListener('click', () => {
    const email = participantEmail.value.trim().toLowerCase();
    if (!email) { participantMsg.textContent = 'Please enter an email address.'; return; }
    participantMsg.className = 'participant-popover__msg';
    participantMsg.textContent = 'Searching…';
    db.collection('users').where('email', '==', email).get()
      .then(snap => {
        if (snap.empty) {
          participantMsg.textContent = 'User not found.';
          return;
        }
        const foundUid = snap.docs[0].id;
        return db.doc(`boards/${BOARD_ID}`).get().then(boardSnap => {
          if (!boardSnap.exists) return;
          const users = boardSnap.data().users || [];
          if (users.includes(foundUid)) {
            participantMsg.textContent = 'User is already a participant.';
            return;
          }
          const owner = boardSnap.data().owner || '';
          const newUsers = [...users, foundUid];
          return db.doc(`boards/${BOARD_ID}`).update({ users: newUsers }).then(() => {
            participantMsg.className = 'participant-popover__msg ok';
            participantMsg.textContent = 'Participant added!';
            renderParticipants(owner, newUsers);
            setTimeout(closeParticipantPopover, 1200);
          });
        });
      })
      .catch(err => {
        console.error(err);
        participantMsg.textContent = 'Error. Please try again.';
      });
  });

  // ── Board options dropdown (rename / delete) ──────────────────────────────
  const boardOptionsBtn = document.getElementById('boardOptionsBtn');
  const boardDropdown   = document.getElementById('boardDropdown');

  boardOptionsBtn.addEventListener('click', e => {
    e.stopPropagation();
    boardDropdown.classList.toggle('open');
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
          showToast('Board renamed ?');
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

  // -- Custom board combobox toggle --------------------------------------------
  const boardComboTrigger = document.getElementById('boardComboTrigger');
  const boardComboMenu    = document.getElementById('boardComboMenu');
  boardComboTrigger.addEventListener('click', e => {
    e.stopPropagation();
    // Close tags popup if open
    const tagsPopup = document.getElementById('tagsPopup');
    const tagsBtn   = document.getElementById('tagsBtn');
    if (tagsPopup) { tagsPopup.classList.remove('open'); tagsBtn?.classList.remove('open'); }
    const isOpen = boardComboMenu.classList.toggle('open');
    boardComboTrigger.classList.toggle('open', isOpen);
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
      owner: uid,
      users: uid ? [uid] : [],
      tags,
      columns: { columns: [
        { id: 1,  title: 'To Do'       },
        { id: 2,  title: 'In Progress' },
        { id: 3,  title: 'Review'      },
        { id: 98, title: 'Done'        },
        { id: 99, title: 'Archive', archive: true }
      ]},
      tasks: { columns: [
        { id: 1,  tasks: [] }, { id: 2, tasks: [] },
        { id: 3,  tasks: [] }, { id: 98, tasks: [] },
        { id: 99, tasks: [] }
      ]}
    };
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
    dragSrcEl = null;
    saveChanges(true);
  });

  // ── Build board from Firestore data ─────────────────────────────────────
  const months       = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
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
        <button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button>
      </div>`;
      board.appendChild(div);
      setupColDropdown(div);
      if (!col.archive && col.id > maxId) maxId = col.id;
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
    const allEntries = [];
    data.columns.forEach(col => {
      col.tasks.forEach(taskData => {
        (taskData.timeline || []).forEach(entry =>
          allEntries.push({ ...entry, cardTitle: taskData.text.slice(0, 45) })
        );
      });
    });
    allEntries.sort((a, b) => {
      const [am, ad] = a.date.split(' ');
      const [bm, bd] = b.date.split(' ');
      return (months[am] * 31 + +ad) - (months[bm] * 31 + +bd);
    });
    allEntries.forEach(e => {
      if ((e.type || 'edit') === 'create') return;
      logActivity(
        e.type || 'edit',
        `<b>${e.author}</b> ${e.text} — <em>${e.cardTitle}</em>`,
        e.date
      );
    });
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
    task.classList.toggle('task--expanded');
    // Close any open comment edits
    task.querySelectorAll('.task__tl-entry--editing').forEach(entry => {
      entry.classList.remove('task__tl-entry--editing');
      const textDiv = entry.querySelector('.task__tl-text');
      if (!textDiv) return;
      const t = textDiv._savedTime || '';
      textDiv.innerHTML = `${textDiv.dataset.comment || ''}<div class='task__tl-meta'><time>${t}</time><b>${textDiv._savedAuthor || ''}</b></div>`;
    });
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
      if (window._openEditModal) window._openEditModal(task);
      return;
    }

    // Delete
    if (e.target.closest('.task__opt-delete')) {
      const task     = e.target.closest('.task');
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
        setTimeout(() => { task.remove(); saveChanges(true); }, 200);
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
      const current = textDiv.dataset.comment || '';
      const metaTime = textDiv.querySelector('.task__tl-meta time')?.textContent || '';
      // Close any other open edits in the same card
      entry.closest('.task__timeline')?.querySelectorAll('.task__tl-entry--editing').forEach(other => {
        if (other === entry) return;
        other.classList.remove('task__tl-entry--editing');
        const otherDiv = other.querySelector('.task__tl-text');
        if (!otherDiv) return;
        const t = otherDiv._savedTime || '';
        otherDiv.innerHTML = `${otherDiv.dataset.comment || ''}<div class='task__tl-meta'><time>${t}</time><b>${otherDiv._savedAuthor || ''}</b></div>`;
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
          textDiv.innerHTML = `${textDiv.dataset.comment || ''}<div class='task__tl-meta'><time>${t}</time><b>${textDiv._savedAuthor || _authorName()}</b></div>`;
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
      const cardText = entry.closest('.task')?.querySelector('p')?.textContent.slice(0, 40) || 'Card';
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
        saveChanges(true);
      });
      return;
    }
    if (e.target.closest('.task__tl-edit-cancel')) {
      const entry   = e.target.closest('.task__tl-entry');
      const textDiv = entry.querySelector('.task__tl-text');
      const current = textDiv.dataset.comment || '';
      const time    = textDiv._savedTime || '';
      entry.classList.remove('task__tl-entry--editing');
      textDiv.innerHTML = `${current}<div class='task__tl-meta'><time>${time}</time><b>${textDiv._savedAuthor || _authorName()}</b></div>`;
      return;
    }
    if (e.target.closest('.task__tl-edit-save')) {
      const entry   = e.target.closest('.task__tl-entry');
      const textDiv = entry.querySelector('.task__tl-text');
      const input   = textDiv.querySelector('.task__tl-edit-input');
      const newText = input.value.trim();
      if (!newText) { input.focus(); return; }
      const time = textDiv._savedTime || '';
      entry.classList.remove('task__tl-entry--editing');
      textDiv.dataset.comment = newText;
      textDiv.innerHTML = `${newText}<div class='task__tl-meta'><time>${time}</time><b>${textDiv._savedAuthor || _authorName()}</b></div>`;
      const cardText = entry.closest('.task')?.querySelector('p')?.textContent.slice(0, 40) || 'Card';
      logActivity('edit', `<b>${_authorName()}</b> edited a comment on "${cardText}"`);
      saveChanges();
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

      const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const entry = document.createElement('div');
      entry.className = 'task__tl-entry';
      entry.innerHTML = `<span class='task__tl-dot task__tl-dot--comment'>${_authorAvatar()}</span>
        <div class='task__tl-text' data-comment="${comment.replace(/"/g, '&quot;')}" data-author-photo='${_authorPhoto()}'>${comment}<div class='task__tl-meta'><time>${today}</time><b>${_authorName()}</b></div></div>`;

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
    saveChanges(true);
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
    topbarUser.classList.toggle('open');
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
