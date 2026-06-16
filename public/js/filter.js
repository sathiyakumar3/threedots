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
        if (typeof db !== 'undefined' && typeof BOARD_ID !== 'undefined' && BOARD_ID) {
          const batch = db.batch();
          window._localWriteIds = window._localWriteIds || new Set();
          sorted.forEach((card, idx) => {
            const taskId = card.dataset.id;
            if (!taskId) return;
            window._localWriteIds.add(taskId);
            batch.update(
              db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId),
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
            .catch(() => {});
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
    const labels = (typeof tagLabels !== 'undefined') ? tagLabels : {};
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

  // ── Group by Tag: sticky dividers inside existing columns ──────────────
  let _groupByTag    = false;
  let _cardOrigOrder = new Map(); // card el → { col, nextSibling }

  function _getTagId(card) {
    const cls = [...card.querySelectorAll('[class*="task__tag--"]')]
      .map(el => [...el.classList].find(c => c.startsWith('task__tag--')))
      .find(Boolean);
    return cls ? cls.replace('task__tag--', '') : '__none__';
  }

  function _makeDivider(tag, count) {
    const d = document.createElement('div');
    d.className = 'swimlane-divider';
    d.dataset.tagId = tag.id;
    d.innerHTML =
      `<span class="swimlane-divider__dot" style="background:${tag.color}"></span>` +
      `<span class="swimlane-divider__label">${tag.label}</span>` +
      `<span class="swimlane-divider__line"></span>` +
      `<span class="swimlane-divider__count">${count}</span>`;
    return d;
  }

  function buildSwimlaneBoard() {
    const boardEl = document.querySelector('.project-tasks');
    if (!boardEl || _cardOrigOrder.size) return;

    const allTags = typeof window._getActiveTags === 'function' ? window._getActiveTags() : [];
    const tagMap  = {};
    allTags.forEach(t => { tagMap[t.id] = t; });
    tagMap['__none__'] = { id: '__none__', label: 'Untagged', color: '#9ca3af' };

    const cols = [...boardEl.querySelectorAll(
      '.project-column:not(.project-column--archive):not(.project-column--trash)'
    )];

    // Collect every tag id that appears in any column, in tag order, __none__ last
    const globalTagCounts = {};
    cols.forEach(col => {
      [...col.querySelectorAll(':scope > .task')].forEach(card => {
        const id = _getTagId(card);
        globalTagCounts[id] = (globalTagCounts[id] || 0) + 1;
      });
    });
    const presentTagIds = allTags.map(t => t.id).filter(id => globalTagCounts[id]);
    if (globalTagCounts['__none__']) presentTagIds.push('__none__');
    if (!presentTagIds.length) return;

    cols.forEach(col => {
      const cards = [...col.querySelectorAll(':scope > .task')];
      if (!cards.length) return;

      // Remember original order
      cards.forEach(card => {
        _cardOrigOrder.set(card, { col, nextSibling: card.nextSibling });
      });

      // Group cards by tag
      const cardsByTag = {};
      cards.forEach(card => {
        const id = _getTagId(card);
        if (!cardsByTag[id]) cardsByTag[id] = [];
        cardsByTag[id].push(card);
      });

      const dropZone = col.querySelector('.drop-zone');

      // Render EVERY tag section in EVERY column (empty sections get count 0)
      presentTagIds.forEach(tagId => {
        const tag      = tagMap[tagId] || tagMap['__none__'];
        const colCards = cardsByTag[tagId] || [];

        const div = _makeDivider(tag, colCards.length);
        dropZone ? col.insertBefore(div, dropZone) : col.appendChild(div);

        const group = document.createElement('div');
        group.className    = 'swimlane-group';
        group.dataset.tagId = tagId;
        dropZone ? col.insertBefore(group, dropZone) : col.appendChild(group);

        colCards.forEach(card => group.appendChild(card));

        // Highlight group on dragover so user sees where they'll drop
        group.addEventListener('dragover', e => {
          e.preventDefault();
          document.querySelectorAll('.swimlane-group.drag-over').forEach(g => g.classList.remove('drag-over'));
          group.classList.add('drag-over');
        });
        group.addEventListener('dragleave', e => {
          if (!group.contains(e.relatedTarget)) group.classList.remove('drag-over');
        });
        group.addEventListener('drop', () => group.classList.remove('drag-over'));
      });
    });

    // Equalize group heights so the same tag section lines up across columns
    requestAnimationFrame(() => _equalizeGroupHeights(boardEl));
  }

  function _equalizeGroupHeights(boardEl) {
    boardEl = boardEl || document.querySelector('.project-tasks');
    if (!boardEl) return;
    // Reset min-heights first so shrinkage is measured correctly
    boardEl.querySelectorAll('.swimlane-group').forEach(g => { g.style.minHeight = ''; });
    // Group by tagId, measure, then apply max
    const byTag = {};
    boardEl.querySelectorAll('.swimlane-group').forEach(g => {
      const id = g.dataset.tagId;
      if (!byTag[id]) byTag[id] = [];
      byTag[id].push(g);
    });
    Object.values(byTag).forEach(groups => {
      const maxH = Math.max(0, ...groups.map(g => g.getBoundingClientRect().height));
      groups.forEach(g => { g.style.minHeight = maxH + 'px'; });
    });
  }

  function teardownSwimlaneBoard() {
    if (!_cardOrigOrder.size) return;

    // Lift cards out of group wrappers, then remove wrappers + dividers
    document.querySelectorAll('.project-tasks .swimlane-group').forEach(group => {
      const col  = group.closest('.project-column');
      const zone = col?.querySelector('.drop-zone');
      [...group.querySelectorAll(':scope > .task')].forEach(card => {
        zone ? col.insertBefore(card, zone) : col?.appendChild(card);
      });
      group.remove();
    });
    document.querySelectorAll('.project-tasks .swimlane-divider').forEach(d => d.remove());

    // Restore original card positions
    _cardOrigOrder.forEach((origin, card) => {
      const { col, nextSibling } = origin;
      if (nextSibling && col.contains(nextSibling)) {
        col.insertBefore(card, nextSibling);
      } else {
        const zone = col.querySelector('.drop-zone');
        zone ? col.insertBefore(card, zone) : col.appendChild(card);
      }
    });
    _cardOrigOrder.clear();
  }

  // Expose toggle for keyboard shortcut
  window._toggleSwimlane = () => document.getElementById('groupByTagBtn')?.click();

  // Called after a card is drag-dropped — updates tag if card moved to a different group
  window._swimlaneOnCardDrop = function(card) {
    if (!_groupByTag || !card) return;
    const group = card.closest('.swimlane-group');
    if (!group) return;
    const newTagId = group.dataset.tagId;
    const oldTagId = _getTagId(card);
    if (newTagId !== oldTagId) {
      // Update tag span class + label
      const tagSpan = card.querySelector('.task__tag');
      if (tagSpan) {
        tagSpan.className   = `task__tag task__tag--${newTagId}`;
        tagSpan.textContent = tagLabels[newTagId] || newTagId;
      }
      // Full save to persist new tag to Firestore
      saveTask(card, true);
      // Update divider counts for old and new groups in this column
      const col = group.closest('.project-column');
      if (col) {
        const oldGroup = col.querySelector(`.swimlane-group[data-tag-id="${oldTagId}"]`);
        [oldGroup, group].forEach(g => {
          if (!g) return;
          const count   = g.querySelectorAll(':scope > .task').length;
          const divider = g.previousElementSibling;
          if (divider?.classList.contains('swimlane-divider')) {
            divider.querySelector('.swimlane-divider__count').textContent = count;
          }
        });
      }
    }
    requestAnimationFrame(() => _equalizeGroupHeights());
  };

  // Called after a card is edited — moves it to the correct tag group
  window._swimlaneRefreshCard = function(card) {
    if (!_groupByTag) return;
    const col = card.closest('.project-column');
    if (!col) return;
    const newTagId = _getTagId(card);
    const targetGroup = col.querySelector(`.swimlane-group[data-tag-id="${newTagId}"]`);
    if (!targetGroup) {
      // Tag group doesn't exist yet in this column — rebuild cleanly
      teardownSwimlaneBoard();
      buildSwimlaneBoard();
      return;
    }
    const currentGroup = card.closest('.swimlane-group');
    if (currentGroup === targetGroup) return; // already in the right place
    targetGroup.appendChild(card);
    // Update divider counts for both groups
    [currentGroup, targetGroup].forEach(g => {
      if (!g) return;
      const count = g.querySelectorAll(':scope > .task').length;
      const divider = g.previousElementSibling;
      if (divider?.classList.contains('swimlane-divider')) {
        divider.querySelector('.swimlane-divider__count').textContent = count;
      }
    });
    // Re-equalize all row heights after the card moved
    requestAnimationFrame(() => _equalizeGroupHeights());
  };

  // Strip swimlane structure from a single column before it collapses to the bar
  window._swimlanePrepareCollapse = function(colEl) {
    if (!_groupByTag) return;
    colEl.querySelectorAll('.swimlane-group').forEach(group => {
      const zone = colEl.querySelector('.drop-zone');
      [...group.querySelectorAll(':scope > .task')].forEach(card => {
        _cardOrigOrder.delete(card); // remove from teardown tracking
        zone ? colEl.insertBefore(card, zone) : colEl.appendChild(card);
      });
      group.remove();
    });
    colEl.querySelectorAll('.swimlane-divider').forEach(d => d.remove());
  };

  // Tear down and rebuild the entire swimlane (called after a column is expanded)
  window._swimlaneRebuild = function() {
    if (!_groupByTag) return;
    teardownSwimlaneBoard();
    buildSwimlaneBoard();
  };

  // ── Clear all filters ────────────────────────────────────────────────────
  function clearFilters() {
    _activeTag      = '';
    _activePriority = '';
    _activeAssignee = '';
    _activeSort     = 'default';
    _groupByTag     = false;
    teardownSwimlaneBoard();
    document.getElementById('groupByTagBtn')?.classList.remove('active');
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

    // Group by Tag → sticky dividers inside existing columns
    const groupByTagBtn = document.getElementById('groupByTagBtn');
    if (groupByTagBtn) {
      groupByTagBtn.addEventListener('click', () => {
        _groupByTag = !_groupByTag;
        groupByTagBtn.classList.toggle('active', _groupByTag);
        if (_groupByTag) {
          buildSwimlaneBoard();
        } else {
          teardownSwimlaneBoard();
        }
      });
    }

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
