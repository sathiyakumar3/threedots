// ── Window aliases ──
const { showToast, logActivity } = window;
const { saveChanges } = window;

// ── Board filter & sort ───────────────────────────────────────────────────
(function () {
  let _activeTag      = '';   // tag key or ''
  let _activePriority = '';   // 'low' | 'medium' | 'high' | 'critical' | 'none' | ''
  let _activeAssignee = '';   // display-name fragment or ''
  let _activeSort     = 'default';

  const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, '': 4 };

  // ── Apply all active filters + sort to every column ────────────────────
  function applyFilters() {
    const board = document.querySelector('.project-tasks');
    if (!board) return;

    board.querySelectorAll('.project-column').forEach(col => {
      const cards = [...col.querySelectorAll(':scope > .task')];

      // 1. Visibility filter
      cards.forEach(card => {
        // Use DOM class check — more reliable than searching the text index
        const tagMatch  = !_activeTag      || !!card.querySelector(`.task__tag--${_activeTag}`);
        const prioVal   = card.dataset.priority || '';
        const prioMatch = !_activePriority
          || (_activePriority === 'none' && !prioVal)
          || prioVal === _activePriority;
        const assignee  = (card.dataset.assignee || '').toLowerCase();
        const assMatch  = !_activeAssignee || assignee.includes(_activeAssignee.toLowerCase());
        const hidden    = !(tagMatch && prioMatch && assMatch);
        card.classList.toggle('task--filter-hidden', hidden);
      });

      // 2. Sort (only if a non-default sort is active)
      if (_activeSort !== 'default') {
        const sorted = [...cards].sort((a, b) => {
          if (_activeSort === 'priority') {
            const pa = PRIORITY_ORDER[a.dataset.priority || ''] ?? 4;
            const pb = PRIORITY_ORDER[b.dataset.priority || ''] ?? 4;
            return pa - pb;
          }
          if (_activeSort === 'deadline') {
            const da = a.dataset.deadline ? new Date(a.dataset.deadline) : new Date(9e15);
            const db = b.dataset.deadline ? new Date(b.dataset.deadline) : new Date(9e15);
            return da - db;
          }
          if (_activeSort === 'created') {
            const ca = a.dataset.created ? new Date(a.dataset.created) : 0;
            const cb = b.dataset.created ? new Date(b.dataset.created) : 0;
            return cb - ca; // newest first
          }
          if (_activeSort === 'title') {
            const ta = (a.dataset.title || a.querySelector('.task__title')?.textContent || '').toLowerCase();
            const tb = (b.dataset.title || b.querySelector('.task__title')?.textContent || '').toLowerCase();
            return ta.localeCompare(tb);
          }
          return 0;
        });
        sorted.forEach(card => col.appendChild(card));

        // Persist new order to Firestore
        if (window.db && typeof window.BOARD_ID !== 'undefined' && window.BOARD_ID) {
          const batch = window.db.batch();
          window._localWriteIds = window._localWriteIds || new Set();
          sorted.forEach((card, idx) => {
            const taskId = card.dataset.id;
            if (!taskId) return;
            window._localWriteIds.add(taskId);
            batch.update(
              window.db.collection(`boards/${window.BOARD_ID}/tasks`).doc(taskId),
              { order: idx }
            );
          });
          batch.commit()
            .then(() => {
              sorted.forEach(card => {
                const id = card.dataset.id;
                if (id) setTimeout(() => window._localWriteIds?.delete(id), 500);
              });
            })
            .catch(err => console.error('Order save failed:', err));
        }
      }
    });

    // Show/hide clear button
    const hasFilter = _activeTag || _activePriority || _activeAssignee || _activeSort !== 'default';
    document.getElementById('filterClear')?.classList.toggle('filter-bar__clear--visible', hasFilter);
    document.getElementById('filterBar')?.classList.toggle('filter-bar--active', hasFilter);
  }

  // ── Populate tag menu from tagLabels (populated/mutated by tags.js) ──────
  function buildTagMenu() {
    const menu = document.getElementById('filterTagMenu');
    if (!menu) return;
    // tagLabels is a const in utils.js — accessible as a plain global (not window.tagLabels)
    const labels = window.tagLabels || {};
    const prevActive = _activeTag; // preserve current selection
    menu.innerHTML = `<button class="filter-chip__opt${!prevActive ? ' filter-chip__opt--active' : ''}" data-value="">All</button>` +
      Object.entries(labels).map(([k, v]) =>
        `<button class="filter-chip__opt${_activeTag === k ? ' filter-chip__opt--active' : ''}" data-value="${k}"><span class="filter-tag-dot tag-dot--${k}"></span>${v}</button>`
      ).join('');
    menu.querySelectorAll('.filter-chip__opt').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTag = btn.dataset.value;
        menu.querySelectorAll('.filter-chip__opt').forEach(b => b.classList.remove('filter-chip__opt--active'));
        btn.classList.add('filter-chip__opt--active');
        const label = btn.dataset.value
          ? (btn.querySelector('.filter-tag-dot') ? btn.textContent.trim() : btn.dataset.value)
          : 'Tag';
        updateChipLabel('filterTagBtn', 'fas fa-tag', label, !!btn.dataset.value);
        menu.classList.remove('open');
        applyFilters();
      });
    });
  }

  // ── Populate assignee menu from current board members ───────────────────
  function buildAssigneeMenu() {
    const menu = document.getElementById('filterAssigneeMenu');
    if (!menu) return;
    // Gather unique assignee display names from cards
    const names = new Set();
    document.querySelectorAll('.task[data-assignee]').forEach(c => {
      const a = c.dataset.assignee || '';
      if (a) a.split(', ').forEach(n => n.trim() && names.add(n.trim()));
    });
    menu.innerHTML = `<button class="filter-chip__opt filter-chip__opt--active" data-value="">All</button>` +
      [...names].sort().map(n =>
        `<button class="filter-chip__opt" data-value="${n}">${n}</button>`
      ).join('');
    menu.querySelectorAll('.filter-chip__opt').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeAssignee = btn.dataset.value;
        menu.querySelectorAll('.filter-chip__opt').forEach(b => b.classList.remove('filter-chip__opt--active'));
        btn.classList.add('filter-chip__opt--active');
        const label = btn.dataset.value || 'Assignee';
        updateChipLabel('filterAssigneeBtn', 'fas fa-user', label, !!btn.dataset.value);
        menu.classList.remove('open');
        applyFilters();
      });
    });
  }

  // ── Update a chip button label ──────────────────────────────────────────
  function updateChipLabel(btnId, iconCls, label, isActive) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.innerHTML = `<i class="${iconCls}"></i> ${label} <i class="fas fa-chevron-down filter-chip__caret"></i>`;
    btn.classList.toggle('filter-chip--active', isActive);
  }

  // ── Chip menu toggle (mutual exclusion) ─────────────────────────────────
  function setupChipToggle(btnId, menuId) {
    const btn  = document.getElementById(btnId);
    const menu = document.getElementById(menuId);
    if (!btn || !menu) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('open');
      // Close all chip menus
      document.querySelectorAll('.filter-chip__menu').forEach(m => m.classList.remove('open'));
      if (!isOpen) menu.classList.add('open');
    });
  }

  // ── Priority menu ────────────────────────────────────────────────────────
  function setupPriorityMenu() {
    const menu = document.getElementById('filterPrioMenu');
    if (!menu) return;
    menu.querySelectorAll('.filter-chip__opt').forEach(btn => {
      btn.addEventListener('click', () => {
        _activePriority = btn.dataset.value;
        menu.querySelectorAll('.filter-chip__opt').forEach(b => b.classList.remove('filter-chip__opt--active'));
        btn.classList.add('filter-chip__opt--active');
        const label = btn.dataset.value
          ? (btn.dataset.value === 'none' ? 'None' : btn.dataset.value[0].toUpperCase() + btn.dataset.value.slice(1))
          : 'Priority';
        updateChipLabel('filterPrioBtn', 'fas fa-flag', label, !!btn.dataset.value);
        menu.classList.remove('open');
        applyFilters();
      });
    });
  }

  // ── Sort menu ────────────────────────────────────────────────────────────
  function setupSortMenu() {
    const menu = document.getElementById('filterSortMenu');
    if (!menu) return;
    menu.querySelectorAll('.filter-chip__opt').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeSort = btn.dataset.value;
        menu.querySelectorAll('.filter-chip__opt').forEach(b => b.classList.remove('filter-chip__opt--active'));
        btn.classList.add('filter-chip__opt--active');
        const label = btn.textContent.trim();
        updateChipLabel('filterSortBtn', 'fas fa-sort', label, _activeSort !== 'default');
        menu.classList.remove('open');
        applyFilters();
      });
    });
  }

  // ── Clear all filters ────────────────────────────────────────────────────
  function clearFilters() {
    _activeTag      = '';
    _activePriority = '';
    _activeAssignee = '';
    _activeSort     = 'default';
    // Reset chip labels
    updateChipLabel('filterTagBtn',      'fas fa-tag',  'Tag',      false);
    updateChipLabel('filterPrioBtn',     'fas fa-flag', 'Priority', false);
    updateChipLabel('filterAssigneeBtn', 'fas fa-user', 'Assignee', false);
    updateChipLabel('filterSortBtn',     'fas fa-sort', 'Default',  false);
    // Reset active states in all menus
    document.querySelectorAll('.filter-chip__opt').forEach(b => {
      b.classList.toggle('filter-chip__opt--active', b.dataset.value === '' || b.dataset.value === 'default');
    });
    document.querySelectorAll('.filter-chip__menu').forEach(m => m.classList.remove('open'));
    applyFilters();
  }

  // ── Close menus on outside click ─────────────────────────────────────────
  document.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip__menu').forEach(m => m.classList.remove('open'));
  });

  // ── Toggle filter bar visibility ────────────────────────────────────
  function openFilterBar() {
    const bar = document.getElementById('filterBar');
    const btn = document.getElementById('filterToggle');
    bar?.classList.add('filter-bar--open');
    btn?.classList.add('active');
    btn && (btn.title = 'Hide filters');
  }
  function closeFilterBar() {
    const bar = document.getElementById('filterBar');
    const btn = document.getElementById('filterToggle');
    bar?.classList.remove('filter-bar--open');
    btn?.classList.remove('active');
    btn && (btn.title = 'Filter & Sort');
    // Also close any open chip menus
    document.querySelectorAll('.filter-chip__menu').forEach(m => m.classList.remove('open'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildTagMenu();
    setupChipToggle('filterTagBtn',      'filterTagMenu');
    setupChipToggle('filterPrioBtn',     'filterPrioMenu');
    setupChipToggle('filterAssigneeBtn', 'filterAssigneeMenu');
    setupChipToggle('filterSortBtn',     'filterSortMenu');
    setupPriorityMenu();
    setupSortMenu();
    document.getElementById('filterClear')?.addEventListener('click', clearFilters);

    // Topbar toggle button
    document.getElementById('filterToggle')?.addEventListener('click', () => {
      const bar = document.getElementById('filterBar');
      bar?.classList.contains('filter-bar--open') ? closeFilterBar() : openFilterBar();
    });

    // Re-build assignee list when board loads
    window._refreshFilterAssignees = buildAssigneeMenu;
    // Apply filters after board renders
    window._applyBoardFilters = applyFilters;

    // Hook into _applyBoardTags so the tag menu rebuilds when board tags load/change
    const _origApplyBoardTags = window._applyBoardTags;
    window._applyBoardTags = (tags) => {
      if (_origApplyBoardTags) _origApplyBoardTags(tags);
      setTimeout(buildTagMenu, 0);
    };
  });

  // ── Reset filters when board switches ───────────────────────────────────
  window._resetBoardFilters = () => {
    clearFilters();
    closeFilterBar();
  };
}());
