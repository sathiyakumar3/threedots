// ── Bulk Card Selection ───────────────────────────────────────────────────
(function () {
  const bar       = document.getElementById('bulkBar');
  const countEl   = document.getElementById('bulkCount');
  const deselBtn  = document.getElementById('bulkDeselect');
  const tagBtn    = document.getElementById('bulkTagBtn');
  const prioBtn   = document.getElementById('bulkPrioBtn');
  const moveBtn   = document.getElementById('bulkMoveBtn');
  const deleteBtn = document.getElementById('bulkDeleteBtn');
  const tagPopup  = document.getElementById('bulkTagPopup');
  const prioPopup = document.getElementById('bulkPrioPopup');
  const movePopup = document.getElementById('bulkMovePopup');

  const _selectedIds = new Set();
  const _boardEl = document.querySelector('.project-tasks');

  // ── State helpers ─────────────────────────────────────────────────────────
  function _update() {
    const n = _selectedIds.size;
    bar.classList.toggle('active', n > 0);
    if (_boardEl) _boardEl.classList.toggle('board--bulk-active', n > 0);
    countEl.textContent = `${n} card${n !== 1 ? 's' : ''} selected`;
  }

  function _selectCard(cardEl) {
    const id = cardEl.dataset.id;
    if (!id) return;
    _selectedIds.add(id);
    cardEl.classList.add('task--selected');
    const cb = cardEl.querySelector('.task__select-cb');
    if (cb) cb.checked = true;
    _update();
  }

  function _deselectCard(cardEl) {
    const id = cardEl.dataset.id;
    _selectedIds.delete(id);
    cardEl.classList.remove('task--selected');
    const cb = cardEl.querySelector('.task__select-cb');
    if (cb) cb.checked = false;
    _update();
  }

  function _deselectAll() {
    _selectedIds.clear();
    document.querySelectorAll('.task--selected').forEach(c => {
      c.classList.remove('task--selected');
      const cb = c.querySelector('.task__select-cb');
      if (cb) cb.checked = false;
    });
    _update();
  }

  // Expose for external callers (e.g. board reload)
  window._bulkDeselectAll = _deselectAll;

  // ── Checkbox click (event delegation on board) ────────────────────────────
  document.addEventListener('click', e => {
    const cb = e.target.closest('.task__select-cb');
    if (!cb) return;
    e.stopPropagation();
    const card = cb.closest('.task');
    if (!card) return;
    cb.checked ? _selectCard(card) : _deselectCard(card);
  }, true);

  // ── Click anywhere on a card toggles selection while bulk mode is active ──
  document.addEventListener('click', e => {
    if (!_selectedIds.size) return;                       // bulk mode not active
    const card = e.target.closest('.task');
    if (!card) return;
    // Ignore clicks on interactive elements so edit/delete/options still work
    if (e.target.closest('button, a, input, label, .task__dropdown, [contenteditable]')) return;
    const id = card.dataset.id;
    if (!id) return;
    if (_selectedIds.has(id)) {
      _deselectCard(card);
    } else {
      _selectCard(card);
    }
  });

  // ── Deselect all ─────────────────────────────────────────────────────────
  deselBtn.addEventListener('click', _deselectAll);

  // ── Close all popups helper ───────────────────────────────────────────────
  function _closePopups() {
    tagPopup.classList.remove('open');
    prioPopup.classList.remove('open');
    movePopup.classList.remove('open');
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('#bulkTagBtn')  && !e.target.closest('#bulkTagPopup'))  tagPopup.classList.remove('open');
    if (!e.target.closest('#bulkPrioBtn') && !e.target.closest('#bulkPrioPopup')) prioPopup.classList.remove('open');
    if (!e.target.closest('#bulkMoveBtn') && !e.target.closest('#bulkMovePopup')) movePopup.classList.remove('open');
  });

  // ── Bulk Tag ──────────────────────────────────────────────────────────────
  tagBtn.addEventListener('click', e => {
    e.stopPropagation();
    _closePopups();
    tagPopup.innerHTML = Object.entries(tagLabels).map(([id, label]) =>
      `<button class="bulk-tag-item" data-tag="${id}">
         <span class="task__tag task__tag--${id}">${label}</span>
       </button>`
    ).join('');
    tagPopup.classList.add('open');
  });

  tagPopup.addEventListener('click', e => {
    const btn = e.target.closest('.bulk-tag-item');
    if (!btn) return;
    const tag = btn.dataset.tag;
    let count = 0;
    _selectedIds.forEach(id => {
      const card = document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
      if (!card) return;
      const tagEl = card.querySelector('.task__tag');
      if (!tagEl) return;
      // Replace tag class
      [...tagEl.classList].filter(c => c.startsWith('task__tag--')).forEach(c => tagEl.classList.remove(c));
      tagEl.classList.add(`task__tag--${tag}`);
      tagEl.textContent = tagLabels[tag] || tag;
      // Refresh search cache
      const title  = card.querySelector('.task__title')?.textContent || card.dataset.title || '';
      const desc   = card.querySelector('p')?.textContent || '';
      card.dataset.search = `${title} ${desc} ${tagLabels[tag] || ''} ${card.dataset.priority || ''}`.toLowerCase();
      if (typeof saveTask === 'function') saveTask(card, true);
      count++;
    });
    showToast(`Tag updated for ${count} card${count !== 1 ? 's' : ''}`);
    _closePopups();
  });

  // ── Bulk Priority ─────────────────────────────────────────────────────────
  const PRIORITIES = [
    { value: '',         label: 'None' },
    { value: 'low',      label: 'Low' },
    { value: 'medium',   label: 'Medium' },
    { value: 'high',     label: 'High' },
    { value: 'critical', label: 'Critical' },
  ];

  prioBtn.addEventListener('click', e => {
    e.stopPropagation();
    _closePopups();
    prioPopup.innerHTML = PRIORITIES.map(p =>
      `<button class="bulk-prio-item" data-priority="${p.value}">
         ${p.value
           ? `<span class="task__priority task__priority--${p.value}">${p.label}</span>`
           : `<span style="color:var(--light-grey);font-size:12px">${p.label}</span>`}
       </button>`
    ).join('');
    prioPopup.classList.add('open');
  });

  prioPopup.addEventListener('click', e => {
    const btn = e.target.closest('.bulk-prio-item');
    if (!btn) return;
    const priority = btn.dataset.priority;
    let count = 0;
    _selectedIds.forEach(id => {
      const card = document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
      if (!card) return;
      card.dataset.priority = priority;
      const tagsDiv = card.querySelector('.task__tags');
      if (!tagsDiv) return;
      // Remove existing priority badge
      tagsDiv.querySelector('.task__priority')?.remove();
      // Insert new badge (after tag span, before options button)
      if (priority) {
        const badge = document.createElement('span');
        badge.className = `task__priority task__priority--${priority}`;
        badge.textContent = priority[0].toUpperCase() + priority.slice(1);
        const tagSpan = tagsDiv.querySelector('.task__tag');
        tagSpan ? tagSpan.after(badge) : tagsDiv.prepend(badge);
      }
      // Refresh search cache
      const tagCls = [...(card.querySelector('.task__tag')?.classList || [])].find(c => c.startsWith('task__tag--'));
      const tagId  = tagCls ? tagCls.replace('task__tag--', '') : '';
      const title  = card.querySelector('.task__title')?.textContent || card.dataset.title || '';
      const desc   = card.querySelector('p')?.textContent || '';
      card.dataset.search = `${title} ${desc} ${tagLabels[tagId] || ''} ${priority}`.toLowerCase();
      if (typeof saveTask === 'function') saveTask(card, true);
      count++;
    });
    showToast(`Priority updated for ${count} card${count !== 1 ? 's' : ''}`);
    _closePopups();
  });

  // ── Bulk Move ─────────────────────────────────────────────────────────────
  moveBtn.addEventListener('click', e => {
    e.stopPropagation();
    _closePopups();
    const cols = [...document.querySelectorAll('.project-column')];
    movePopup.innerHTML = cols.map(col => {
      const title = col.querySelector('.project-column-heading__title')?.textContent || 'Column';
      return `<button class="bulk-move-item" data-col-id="${col.dataset.columnId}">${title}</button>`;
    }).join('');
    movePopup.classList.add('open');
  });

  movePopup.addEventListener('click', e => {
    const btn = e.target.closest('.bulk-move-item');
    if (!btn) return;
    const colId    = btn.dataset.colId;
    const targetCol = document.querySelector(`.project-column[data-column-id="${colId}"]`);
    if (!targetCol) return;
    const colTitle = btn.textContent.trim();
    let count = 0;
    const ids = [..._selectedIds];
    ids.forEach(id => {
      const card = document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
      if (!card) return;
      targetCol.appendChild(card);
      if (typeof saveTask === 'function') saveTask(card, true);
      count++;
    });
    if (typeof logActivity === 'function') {
      const author = window.currentUser?.displayName || window.currentUser?.email || 'User';
      logActivity('move', `<b>${author}</b> bulk-moved ${count} card${count !== 1 ? 's' : ''} to <b>${colTitle}</b>`);
    }
    showToast(`${count} card${count !== 1 ? 's' : ''} moved to "${colTitle}"`);
    _deselectAll();
    _closePopups();
  });

  // ── Bulk Delete ───────────────────────────────────────────────────────────
  deleteBtn.addEventListener('click', () => {
    const count = _selectedIds.size;
    if (!count) return;
    Swal.fire({
      title: `Delete ${count} card${count !== 1 ? 's' : ''}?`,
      text:  'Cards in Trash will be permanently deleted. Others will be moved to Trash.',
      icon:  'warning',
      showCancelButton:   true,
      confirmButtonText:  'Delete',
      confirmButtonColor: '#e05252',
      cancelButtonText:   'Cancel',
      reverseButtons:     true,
    }).then(result => {
      if (!result.isConfirmed) return;
      const ids = [..._selectedIds];
      _deselectAll();
      const trashCol = document.querySelector('.project-column--trash');
      let movedCount = 0, deletedCount = 0;
      ids.forEach(id => {
        const card = document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
        if (!card) return;
        const alreadyInTrash = !!card.closest('.project-column--trash');
        card.style.transition = 'opacity .2s';
        card.style.opacity    = '0';
        if (alreadyInTrash) {
          deletedCount++;
          setTimeout(() => {
            card.remove();
            if (id && typeof db !== 'undefined' && typeof BOARD_ID !== 'undefined') {
              db.collection(`boards/${BOARD_ID}/tasks`).doc(id).delete().catch(() => {});
            }
          }, 200);
        } else if (trashCol) {
          movedCount++;
          card.dataset.deletedAt = Date.now().toString();
          setTimeout(() => {
            card.style.opacity = '';
            card.style.transition = '';
            trashCol.appendChild(card);
          }, 200);
        } else {
          deletedCount++;
          setTimeout(() => {
            card.remove();
            if (id && typeof db !== 'undefined' && typeof BOARD_ID !== 'undefined') {
              db.collection(`boards/${BOARD_ID}/tasks`).doc(id).delete().catch(() => {});
            }
          }, 200);
        }
      });
      setTimeout(() => { if (typeof saveChanges === 'function') saveChanges(true); }, 350);
      if (typeof logActivity === 'function') {
        const author = window.currentUser?.displayName || window.currentUser?.email || 'User';
        logActivity('delete', `<b>${author}</b> deleted ${count} card${count !== 1 ? 's' : ''}`);
      }
      if (movedCount && deletedCount) showToast(`${movedCount} moved to Trash, ${deletedCount} permanently deleted`);
      else if (movedCount)            showToast(`${movedCount} card${movedCount !== 1 ? 's' : ''} moved to Trash`);
      else                            showToast(`${deletedCount} card${deletedCount !== 1 ? 's' : ''} permanently deleted`);
    });
  });

  // ── Deselect all when board reloads ──────────────────────────────────────
  // (cards are removed from DOM; clear selection state)
  const _observer = new MutationObserver(mutations => {
    if (!_selectedIds.size) return;
    mutations.forEach(m => {
      m.removedNodes.forEach(n => {
        if (n.dataset?.id && _selectedIds.has(n.dataset.id)) {
          _selectedIds.delete(n.dataset.id);
        }
      });
    });
    _update();
  });
  _observer.observe(document.querySelector('.project-tasks') || document.body, {
    childList: true, subtree: true
  });
})();
