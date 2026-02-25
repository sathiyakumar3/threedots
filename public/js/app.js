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
    db.collection('users').doc(user.uid).set({
      uid:         user.uid,
      displayName: user.displayName || '',
      email:       user.email       || '',
      photoURL:    user.photoURL    || '',
      lastLogin:   firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(err => console.error('Error saving user:', err));
    document.getElementById('navUserName').textContent  = user.displayName || user.email;
    document.getElementById('navUserEmail').textContent = user.email;
    const avatarEl = document.getElementById('navAvatar');
    if (user.photoURL) {
      avatarEl.innerHTML = `<img src='${user.photoURL}' alt='avatar'>`;
    } else {
      avatarEl.textContent = (user.displayName || user.email || '?')[0].toUpperCase();
    }
    loginOverlay.classList.add('hidden');
    appShell.style.display = '';
    loadUserBoards(user.uid);
  }

  function loadUserBoards(uid) {
    // Clear any boards left over from a previous session / account
    board.innerHTML = '';
    document.querySelectorAll('.nav-item[data-tab="board"]').forEach(el => el.remove());
    const boardsQuery = db.collection('boards').where('users', 'array-contains', uid);
    boardsQuery.get()
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
            createBoard(result.value.trim(), false);
          });
          return null;
        }
        return snapshot;
      })
      .then(snapshot => {
        if (!snapshot) return;
        const docs = snapshot.docs.sort((a, b) => {
          if (a.id === 'main') return -1;
          if (b.id === 'main') return  1;
          const na = (a.data().name || '').toLowerCase();
          const nb = (b.data().name || '').toLowerCase();
          return na.localeCompare(nb);
        });
        docs.forEach(doc => addBoardNavItem(doc.id, doc.data().name || doc.id));
        const firstId  = docs[0].id;
        const targetId = docs.find(d => d.id === 'main') ? 'main' : firstId;
        const navItem  = document.querySelector(`.nav-item[data-board-id="${targetId}"]`);
        loadBoard(targetId, navItem);
      })
      .catch(err => {
        console.error('Could not load boards:', err);
        board.insertAdjacentHTML('beforebegin',
          `<p style="color:#e05252;padding:.5rem 1rem;font-size:13px">⚠ Could not connect to Firestore.</p>`);
      });
  }

  function hideApp() {
    currentUser = null;
    // ── Clean up stale board data so it never bleeds into the next login ──
    BOARD_ID = 'main';
    board.innerHTML = '';
    document.querySelectorAll('.nav-item[data-tab="board"]').forEach(el => el.remove());
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

  document.getElementById('logoutBtn').addEventListener('click', () => auth.signOut());

  // ── Search ───────────────────────────────────────────────────────────────
  const boardSearch = document.getElementById('boardSearch');
  const searchClear = document.getElementById('searchClear');

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

  boardSearch.addEventListener('input', () => applySearch(boardSearch.value));
  searchClear.addEventListener('click', () => {
    boardSearch.value = '';
    applySearch('');
    boardSearch.focus();
  });

  // ── Activity panel toggle ────────────────────────────────────────────────
  const activityPanel  = document.getElementById('activityPanel');
  const activityToggle = document.getElementById('activityToggle');
  activityToggle.addEventListener('click', () => {
    const collapsed = activityPanel.classList.toggle('collapsed');
    activityToggle.classList.toggle('active', !collapsed);
    activityToggle.title = collapsed ? 'Show activity' : 'Hide activity';
  });

  // ── Nav panel toggle ─────────────────────────────────────────────────────
  const navPanel  = document.getElementById('navPanel');
  const navToggle = document.getElementById('navToggle');
  navToggle.addEventListener('click', () => navPanel.classList.toggle('collapsed'));

  let dragSrcEl = null;
  const board   = document.querySelector('.project-tasks');

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
  function generateBoardName() {
    const existing = [...document.querySelectorAll('.nav-item[data-tab="board"] span')]
      .map(s => s.textContent.trim());
    if (!existing.includes('New Board')) return 'New Board';
    let i = 2;
    while (existing.includes(`New Board (${i})`)) i++;
    return `New Board (${i})`;
  }

  function addBoardNavItem(id, name) {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.tab     = 'board';
    btn.dataset.boardId = id;
    btn.dataset.label   = name;
    btn.innerHTML = `<i class='fas fa-columns'></i><span>${name}</span>`;
    document.querySelector('.nav-items').appendChild(btn);
    return btn;
  }

  // ── Load a board by Firestore doc ID ────────────────────────────────────
  function loadBoard(id, activeNavEl) {
    BOARD_ID = id;
    board.innerHTML = '';
    document.getElementById('activityFeed').innerHTML = '';
    const srch = document.getElementById('boardSearch');
    if (srch) { srch.value = ''; searchClear.classList.remove('visible'); }
    document.querySelectorAll('.nav-item[data-tab="board"]').forEach(b => b.classList.remove('active'));
    if (activeNavEl) activeNavEl.classList.add('active');
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
          const h1 = document.querySelector('.project-info h1');
          h1.textContent = name;
          h1.title = `Board ID: ${id}`;
          if (activeNavEl) {
            activeNavEl.querySelector('span').textContent = name;
            activeNavEl.dataset.label = name;
          }
          if (data.columns && data.tasks) {
            buildColumnsFromData(data.columns);
            buildTasksFromData(data.tasks);
          }
          renderParticipants(data.owner || '', data.users || []);
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
    // Remove existing avatars only
    container.querySelectorAll('.participant-avatar').forEach(el => el.remove());
    const addBtn = document.getElementById('addParticipantBtn');
    // Show members who are NOT the owner
    const members = userUids.filter(uid => uid !== ownerUid);
    const fetches = members.map(uid =>
      db.collection('users').doc(uid).get().catch(() => null)
    );
    Promise.all(fetches).then(snaps => {
      snaps.forEach(snap => {
        if (!snap || !snap.exists) return;
        const u   = snap.data();
        const av  = document.createElement('div');
        av.className = 'participant-avatar';
        av.title = u.displayName || u.email || 'User';
        if (u.photoURL) {
          av.innerHTML = `<img src='${u.photoURL}' alt='${av.title}'>`;
        } else {
          av.textContent = (u.displayName || u.email || '?')[0].toUpperCase();
        }
        container.insertBefore(av, addBtn);
      });
    });
  }

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

  document.getElementById('boardOptRename').addEventListener('click', () => {
    boardDropdown.classList.remove('open');
    // Trigger the same inline rename as double-click
    document.querySelector('.project-info h1').dispatchEvent(new MouseEvent('dblclick'));
  });

  document.getElementById('boardOptDelete').addEventListener('click', () => {
    boardDropdown.classList.remove('open');
    const boardName = document.querySelector('.project-info h1').textContent.trim();
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
          const navItem = document.querySelector(`.nav-item[data-board-id="${BOARD_ID}"]`);
          if (navItem) navItem.remove();
          const remaining = document.querySelector('.nav-item[data-tab="board"]');
          if (remaining) {
            loadBoard(remaining.dataset.boardId, remaining);
          } else {
            board.innerHTML = '';
            document.querySelector('.project-info h1').textContent = '';
          }
        })
        .catch(err => { console.error(err); showToast('Delete failed', true); });
    });
  });

  // ── Double-click board title (top bar) to rename ───────────────────────────
  document.querySelector('.project-info h1').addEventListener('dblclick', function () {
    if (this.querySelector('input')) return;
    const h1      = this;
    const current = h1.textContent.trim();
    h1.textContent = '';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'board-title-input'; inp.value = current;
    h1.appendChild(inp);
    inp.focus(); inp.select();
    function commitBoardRename() {
      const val = inp.value.trim() || current;
      h1.textContent = val;
      h1.title = `Board ID: ${BOARD_ID}`;
      // Update Firestore
      db.doc(`boards/${BOARD_ID}`).update({ name: val })
        .then(() => showToast('Board renamed ✓'))
        .catch(() => showToast('Rename failed', true));
      // Keep nav sidebar in sync
      const navItem = document.querySelector(`.nav-item[data-board-id="${BOARD_ID}"]`);
      if (navItem) {
        const span = navItem.querySelector('span');
        if (span) span.textContent = val;
        navItem.dataset.label = val;
      }
    }
    inp.addEventListener('blur', commitBoardRename);
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter')  inp.blur();
      if (ev.key === 'Escape') { inp.value = current; inp.blur(); }
    });
  });

  // ── Nav board switching ─────────────────────────────────────────────────────
  document.querySelector('.nav-items').addEventListener('click', e => {
    const item = e.target.closest('.nav-item[data-tab="board"]');
    if (!item || item.classList.contains('active')) return;
    if (item.querySelector('.nav-rename-input')) return;
    loadBoard(item.dataset.boardId, item);
  });

  // ── Nav board rename helper ─────────────────────────────────────────────
  function startNavRename(item) {
    if (item.querySelector('.nav-rename-input')) return;
    const spanEl  = item.querySelector('span');
    const current = spanEl.textContent.trim();
    spanEl.style.display = 'none';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'nav-rename-input';
    inp.value = current;
    item.appendChild(inp);
    inp.focus(); inp.select();
    function commitNavRename() {
      const val = inp.value.trim() || current;
      inp.remove();
      spanEl.style.display = '';
      spanEl.textContent   = val;
      item.dataset.label   = val;
      db.doc(`boards/${item.dataset.boardId}`).update({ name: val })
        .then(() => showToast('Renamed ✓'))
        .catch(() => showToast('Rename failed', true));
      if (item.classList.contains('active')) {
        const h1 = document.querySelector('.project-info h1');
        h1.textContent = val;
        h1.title = `Board ID: ${item.dataset.boardId}`;
      }
    }
    inp.addEventListener('blur', commitNavRename);
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter')  inp.blur();
      if (ev.key === 'Escape') { inp.value = current; inp.blur(); }
    });
    inp.addEventListener('mousedown', ev => ev.stopPropagation());
  }

  // ── Nav board rename on double-click ────────────────────────────────────
  document.querySelector('.nav-items').addEventListener('dblclick', e => {
    const item = e.target.closest('.nav-item[data-tab="board"]');
    if (!item) return;
    startNavRename(item);
  });

  // ── Add new board ────────────────────────────────────────────────────────
  // ── Create a new board and add it to the nav ─────────────────────────────────
  function createBoard(name, autoRename) {
    const uid = currentUser ? currentUser.uid : null;
    const data = {
      name,
      owner: uid,
      users: uid ? [uid] : [],
      columns: { columns: [
        { id: 1,  sequence: 1,  title: 'To Do'       },
        { id: 2,  sequence: 2,  title: 'In Progress' },
        { id: 3,  sequence: 3,  title: 'Review'      },
        { id: 4,  sequence: 4,  title: 'Done'        },
        { id: 99, sequence: 99, title: 'Archive', archive: true }
      ]},
      tasks: { columns: [
        { id: 1,  tasks: [] }, { id: 2, tasks: [] },
        { id: 3,  tasks: [] }, { id: 4, tasks: [] },
        { id: 99, tasks: [] }
      ]}
    };
    return db.collection('boards').add(data)
      .then(docRef => {
        const navItem = addBoardNavItem(docRef.id, name);
        loadBoard(docRef.id, navItem);
        showToast(`Board “${name}” created ✓`);
        if (autoRename) startNavRename(navItem);
        return docRef;
      })
      .catch(err => { console.error('Create board failed:', err); showToast('Could not create board', true); });
  }

  document.getElementById('navAddBoard').addEventListener('click', () => {
    createBoard(generateBoardName(), true);
  });

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
    dragSrcEl.style.opacity = '1';
    clearHighlights();

    const today     = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const moveEntry = document.createElement('div');
    moveEntry.className = 'task__tl-entry';
    moveEntry.innerHTML = `<span class='task__tl-dot task__tl-dot--edit'></span>
      <div class='task__tl-text' data-author-photo='${_authorPhoto()}'>${_authorAvatar()}<b>${_authorName()}</b> moved to <b>${colName}</b><time>${today}</time></div>`;
    let tl = dragSrcEl.querySelector('.task__timeline');
    if (!tl) {
      dragSrcEl.querySelector('.task__footer').insertAdjacentHTML('beforebegin', `<div class='task__timeline'></div>`);
      tl = dragSrcEl.querySelector('.task__timeline');
    }
    tl.appendChild(moveEntry);
    refreshExpandBtn(dragSrcEl);
    dragSrcEl = null;
    saveChanges();
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
    allEntries.forEach(e => logActivity(
      e.type || 'edit',
      `<b>${e.author}</b> ${e.text} — <em>${e.cardTitle}</em>`,
      e.date
    ));
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
    if (e.target.closest('.task__tl-edit-btn'))      return;
    if (e.target.closest('.task__tl-edit-actions'))  return;
    if (e.target.closest('.task__tl-edit-input'))    return;
    if (e.target.closest('.task__tl-entry--editing')) return;
    if (!task.querySelector('.task__timeline'))      return;
    task.classList.toggle('task--expanded');
    if (!task.classList.contains('task--expanded')) {
      const box = task.querySelector('.task__comment-box');
      if (box) box.classList.remove('open');
    }
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
    // Edit — open
    if (e.target.closest('.task__opt-edit')) {
      const task     = e.target.closest('.task');
      task.querySelector('.task__dropdown').classList.remove('open');
      openDropdown   = null;
      const p        = task.querySelector('p');
      const tagSpan  = task.querySelector('.task__tag');
      const tagClass = [...tagSpan.classList].find(c => c.startsWith('task__tag--'));
      const currentTag = tagClass ? tagClass.replace('task__tag--', '') : 'copyright';
      const options    = Object.entries(tagLabels).map(([val, label]) =>
        `<option value="${val}"${val === currentTag ? ' selected' : ''}>${label}</option>`).join('');
      p.insertAdjacentHTML('afterend',
        `<select class='task__edit-tag-select'>${options}</select>
         <textarea class='task__edit-input' rows='2'>${p.textContent}</textarea>
         <div class='task__edit-actions'>
           <button class='task__edit-cancel'>Cancel</button>
           <button class='task__edit-save'>Save</button>
         </div>`);
      tagSpan.style.display = 'none';
      p.style.display       = 'none';
      task.querySelector('.task__edit-input').focus();
      return;
    }
    // Edit — cancel
    if (e.target.closest('.task__edit-cancel')) {
      const task = e.target.closest('.task');
      task.querySelector('.task__edit-tag-select')?.remove();
      task.querySelector('.task__edit-input').remove();
      task.querySelector('.task__edit-actions').remove();
      task.querySelector('.task__tag').style.display = '';
      task.querySelector('p').style.display          = '';
      return;
    }
    // Edit — save
    if (e.target.closest('.task__edit-save')) {
      const task    = e.target.closest('.task');
      const selEl   = task.querySelector('.task__edit-tag-select');
      const input   = task.querySelector('.task__edit-input');
      const p       = task.querySelector('p');
      const tagSpan = task.querySelector('.task__tag');
      if (selEl) {
        const newTag = selEl.value;
        tagSpan.className   = `task__tag task__tag--${newTag}`;
        tagSpan.textContent = tagLabels[newTag];
        selEl.remove();
      }
      const newText = input.value.trim();
      if (newText) p.textContent = newText;
      input.remove();
      task.querySelector('.task__edit-actions').remove();
      tagSpan.style.display = '';
      p.style.display       = '';
      logActivity('edit', `<b>${_authorName()}</b> edited "${p.textContent.slice(0, 40)}"`);
      saveChanges();
      return;
    }
    // Delete
    if (e.target.closest('.task__opt-delete')) {
      const task     = e.target.closest('.task');
      const cardText = task.querySelector('p')?.textContent.slice(0, 40) || 'Card';
      task.style.transition = 'opacity .2s';
      task.style.opacity    = '0';
      setTimeout(() => { task.remove(); saveChanges(); }, 200);
      logActivity('delete', `<b>${_authorName()}</b> deleted "${cardText}"`);
      openDropdown = null;
      return;
    }
  });

  // ── Inline comment edit ──────────────────────────────────────────────────
  board.addEventListener('click', e => {
    if (e.target.closest('.task__tl-edit-btn')) {
      const entry   = e.target.closest('.task__tl-entry');
      const textDiv = entry.querySelector('.task__tl-text');
      const current = textDiv.dataset.comment || '';
      const metaTime = textDiv.querySelector('.task__tl-meta time')?.textContent || '';
      entry.classList.add('task__tl-entry--editing');
      textDiv._savedTime   = metaTime;
      textDiv._savedAuthor = textDiv.querySelector('b')?.textContent || _authorName();
      textDiv.innerHTML    = `<textarea class='task__tl-edit-input' rows='2'>${current}</textarea>
        <div class='task__tl-edit-actions'>
          <button class='task__tl-edit-cancel'>Cancel</button>
          <button class='task__tl-edit-save'>Save</button>
        </div>`;
      textDiv.querySelector('.task__tl-edit-input').focus();
      return;
    }
    if (e.target.closest('.task__tl-edit-cancel')) {
      const entry   = e.target.closest('.task__tl-entry');
      const textDiv = entry.querySelector('.task__tl-text');
      const current = textDiv.dataset.comment || '';
      const time    = textDiv._savedTime || '';
      entry.classList.remove('task__tl-entry--editing');
      const _cAvatar = (textDiv.dataset.authorPhoto)
        ? `<img class='tl-avatar' src='${textDiv.dataset.authorPhoto}' alt='${textDiv._savedAuthor || ''}' title='${textDiv._savedAuthor || ''}'>`
        : `<span class='tl-avatar tl-avatar--initial' title='${textDiv._savedAuthor || ''}'>${(textDiv._savedAuthor || '?')[0].toUpperCase()}</span>`;
      textDiv.innerHTML = `${_cAvatar}<b>${textDiv._savedAuthor || _authorName()}</b> ${current}<div class='task__tl-meta'><time>${time}</time><button class='task__tl-edit-btn' title='Edit comment'><i class='fas fa-pen'></i></button></div>`;
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
      const _sAvatar = (textDiv.dataset.authorPhoto)
        ? `<img class='tl-avatar' src='${textDiv.dataset.authorPhoto}' alt='${textDiv._savedAuthor || ''}' title='${textDiv._savedAuthor || ''}'>`
        : `<span class='tl-avatar tl-avatar--initial' title='${textDiv._savedAuthor || ''}'>${(textDiv._savedAuthor || '?')[0].toUpperCase()}</span>`;
      textDiv.innerHTML = `${_sAvatar}<b>${textDiv._savedAuthor || _authorName()}</b> ${newText}<div class='task__tl-meta'><time>${time}</time><button class='task__tl-edit-btn' title='Edit comment'><i class='fas fa-pen'></i></button></div>`;
      const cardText = entry.closest('.task')?.querySelector('p')?.textContent.slice(0, 40) || 'Card';
      logActivity('edit', `<b>${_authorName()}</b> edited a comment on "${cardText}"`);
      saveChanges();
      return;
    }
  });

  // ── Update button / comment box ──────────────────────────────────────────
  board.addEventListener('click', e => {
    if (e.target.closest('.task__update-btn')) {
      const box = e.target.closest('.task').querySelector('.task__comment-box');
      box.classList.add('open');
      box.querySelector('.task__comment-input').focus();
      return;
    }
    if (e.target.closest('.task__cc-cancel')) {
      const box = e.target.closest('.task').querySelector('.task__comment-box');
      box.classList.remove('open');
      box.querySelector('.task__comment-input').value = '';
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
      entry.innerHTML = `<span class='task__tl-dot task__tl-dot--comment'></span>
        <div class='task__tl-text' data-comment="${comment.replace(/"/g, '&quot;')}" data-author-photo='${_authorPhoto()}'>${_authorAvatar()}<b>${_authorName()}</b> ${comment}<div class='task__tl-meta'><time>${today}</time><button class='task__tl-edit-btn' title='Edit comment'><i class='fas fa-pen'></i></button></div></div>`;

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
      logActivity('comment', `<b>${_authorName()}</b> commented on "${cardText}"`);
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
      return;
    }
    // Delete column
    if (e.target.closest('.col-opt-delete')) {
      const colEl    = e.target.closest('.project-column');
      colEl.querySelector('.col-dropdown').classList.remove('open'); openColDropdown = null;
      const taskCount = colEl.querySelectorAll(':scope > .task').length;
      if (taskCount > 0) {
        showToast(`Move or delete the ${taskCount} card${taskCount > 1 ? 's' : ''} first`, true);
        return;
      }
      colEl.remove();
      syncGrid();
      saveChanges();
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

  // ── Archive toggle ───────────────────────────────────────────────────────
  document.getElementById('archiveBtn').addEventListener('click', function () {
    board.classList.toggle('show-archive');
    this.classList.toggle('active');
    syncGrid();
  });

}); // end DOMContentLoaded
