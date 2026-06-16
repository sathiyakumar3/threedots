// ── FullCalendar board integration ──────────────────────────────────────────
(function () {
  'use strict';

  // Tag → hex color map (falls back to _getActiveTags if available)
  const DEFAULT_TAG_COLORS = {
    urgent:      '#ff595e',
    onhold:      '#ff924c',
    task:        '#ffca3a',
    maintenance: '#c5ca30',
    operation:   '#8ac926',
    support:     '#36949d',
    design:      '#1982c4',
    feature:     '#4267ac',
    issue:       '#565aa0',
    report:      '#6a4c93',
  };

  function getTagColor(tagId) {
    if (window._getActiveTags) {
      const t = window._getActiveTags().find(t => t.id === tagId);
      if (t) return t.color;
    }
    return DEFAULT_TAG_COLORS[tagId] || '#6366f1';
  }

  // Contrast text color (black/white) for a given hex background
  function contrastColor(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16);
    const g = parseInt(c.substr(2, 2), 16);
    const b = parseInt(c.substr(4, 2), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#1a1a2e' : '#ffffff';
  }

  // ISO date string from card dataset value (yyyy-mm-dd or yyyy-mm-dd HH:mm)
  function toFCDate(val) {
    if (!val) return null;
    // FullCalendar expects ISO 8601; replace space with T if time present
    return val.includes(' ') ? val.replace(' ', 'T') : val;
  }

  // Collect all visible cards on the board as FullCalendar events
  function gatherEvents(boardFilter) {
    const events = [];
    document.querySelectorAll('.project-column:not(.project-column--trash)').forEach(col => {
      col.querySelectorAll(':scope > .task').forEach(card => {
        // ── Tag filter ──
        if (activeTagFilter !== null) {
          const tagClass = [...(card.querySelector('.task__tag')?.classList || [])]
            .find(c => c.startsWith('task__tag--'));
          const cardTag = tagClass ? tagClass.replace('task__tag--', '') : 'task';
          if (cardTag !== activeTagFilter) return;
        }
        const start    = card.dataset.startDate || '';
        const deadline = card.dataset.deadline  || '';

        if (start || deadline) {
          const startFC = toFCDate(start)    || toFCDate(deadline);
          const endFC   = toFCDate(deadline) || toFCDate(start);

          const tagClass = [...card.querySelector('.task__tag').classList]
            .find(c => c.startsWith('task__tag--'));
          const tagId  = tagClass ? tagClass.replace('task__tag--', '') : 'task';
          const color  = getTagColor(tagId);
          const title  = card.dataset.title || card.querySelector('p')?.textContent || '(Untitled)';

          // For FullCalendar, if end is same as start, add 1 day to make the block visible
          let endDate = endFC;
          if (endFC && endFC === startFC && !endFC.includes('T')) {
            const d = new Date(endFC);
            d.setDate(d.getDate() + 1);
            endDate = d.toISOString().split('T')[0];
          }

          events.push({
            id:    card.dataset.id,
            title,
            start: startFC,
            end:   endDate || undefined,
            allDay: !(startFC && startFC.includes('T')),
            backgroundColor:   color,
            borderColor:       color,
            textColor:         contrastColor(color),
            extendedProps: {
              cardEl:  card,
              tagId,
              colName: col.querySelector('.project-column-heading__title')?.textContent || ''
            }
          });
        }

      });
    });
    return events;
  }

  // ── Tag filter state ─────────────────────────────────────────────────────
  let activeTagFilter = null; // null = show all

  function buildTagFilter() {
    const container = document.getElementById('calTagFilter');
    if (!container) return;
    const tags = window._getActiveTags ? window._getActiveTags() : [];
    container.innerHTML = '';

    // "All" chip
    const allChip = document.createElement('button');
    allChip.className = 'cal-tag-chip' + (activeTagFilter === null ? ' active' : '');
    allChip.textContent = 'All';
    allChip.addEventListener('click', () => {
      activeTagFilter = null;
      buildTagFilter();
      reloadCalendarEvents();
    });
    container.appendChild(allChip);

    tags.forEach(tag => {
      const chip = document.createElement('button');
      const isActive = activeTagFilter === tag.id;
      chip.className = 'cal-tag-chip' + (isActive ? ' active' : '');
      chip.style.setProperty('--chip-color', tag.color);
      chip.style.setProperty('--chip-bg',    tag.color + '22');
      chip.style.setProperty('--chip-text',  tag.color);
      chip.innerHTML =
        `<span class="cal-tag-chip__dot" style="background:${tag.color}"></span>${tag.label}`;
      chip.addEventListener('click', () => {
        activeTagFilter = isActive ? null : tag.id;
        buildTagFilter();
        reloadCalendarEvents();
      });
      container.appendChild(chip);
    });
  }
  // ── Lazy-load FullCalendar CSS + JS on first calendar open ────────────────────
  function loadFullCalendar(cb) {
    if (typeof FullCalendar !== 'undefined') { cb(); return; }
    if (!document.querySelector('link[href*="fullcalendar@6.1.15"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js';
    s.onload = cb;
    document.head.appendChild(s);
  }
  window._loadFullCalendar = loadFullCalendar;
  // ── Calendar instance ──────────────────────────────────────────────────────
  let calendar = null;
  let calendarInited = false;

  function initCalendar() {
    if (calendarInited || typeof FullCalendar === 'undefined') return;
    calendarInited = true;

    const isDark = document.body.classList.contains('dark');

    calendar = new FullCalendar.Calendar(document.getElementById('fcContainer'), {
      initialView: 'dayGridMonth',
      headerToolbar: {
        left:   'prev,next today',
        center: 'title',
        right:  ''
      },
      height: '100%',
      editable: true,
      eventResizableFromStart: true,
      selectable: true,
      nowIndicator: true,
      dayMaxEvents: 4,
      dragRevertDuration: 0,

      // ── Custom event render ──
      eventContent(arg) {
        const isTodo = arg.event.extendedProps.isTodo;
        const isDone = isTodo && arg.event.classNames.includes('fc-todo-event--done');
        const icon   = isTodo ? (isDone ? '✓' : '○') : '●';
        const title  = arg.event.title;
        return {
          html: `<div class="fc-event-main-frame">` +
                  `<span class="fc-evt-icon">${icon}</span>` +
                  `<span class="fc-event-title">${title}</span>` +
                `</div>`
        };
      },

      // ── Event tooltip ──
      eventDidMount(info) {
        const col       = info.event.extendedProps.colName;
        const isTodo    = info.event.extendedProps.isTodo;
        const cardTitle = info.event.extendedProps.cardTitle;
        if (isTodo) {
          info.el.title = `${info.event.title}\n📋 ${cardTitle}${col ? '  (' + col + ')' : ''}`;
        } else {
          info.el.title = `${info.event.title}${col ? '\n📋 ' + col : ''}`;
        }
      },

      // ── Click event → open edit modal ──
      eventClick(info) {
        const cardEl = info.event.extendedProps.cardEl;
        if (cardEl && window._openEditModal) {
          window._openEditModal(cardEl);
        }
      },

      // ── Drag event back to sidebar → unschedule ──
      eventDragStop(info) {
        const sidebarEl = document.getElementById('calSidebar');
        if (!sidebarEl) return;
        const rect = sidebarEl.getBoundingClientRect();
        const { clientX: x, clientY: y } = info.jsEvent;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          unscheduleCard(info.event);
        }
      },

      // ── Drag / drop → update card dates (todo events are not draggable) ──
      eventDrop(info) {
        if (info.event.extendedProps.isTodo) { info.revert(); return; }
        applyDateChange(info.event);
      },

      // ── Resize → update card dates ──
      eventResize(info) {
        if (info.event.extendedProps.isTodo) { info.revert(); return; }
        applyDateChange(info.event);
      },

      // ── Card dragged from sidebar onto calendar ──
      eventReceive(info) {
        applyExternalDrop(info);
      },

      // ── Select date range → open Add Card modal with dates pre-filled ──
      select(info) {
        // Pre-fill start/deadline pickers if _openModal is available
        if (window._openModal) {
          window._openModal();
          // Give the modal time to init pickers, then set values
          setTimeout(() => {
            const startInput = document.getElementById('cardStartDate');
            const dlInput    = document.getElementById('cardDeadline');
            if (startInput) {
              startInput.value = info.startStr.split('T')[0];
              window._pickerStartDateSet && window._pickerStartDateSet(info.startStr.split('T')[0]);
            }
            if (dlInput && info.endStr) {
              // FC end for allDay is exclusive (next day); step back 1 day
              const endDate = new Date(info.endStr);
              if (info.allDay) endDate.setDate(endDate.getDate() - 1);
              const endISO = endDate.toISOString().split('T')[0];
              dlInput.value = endISO;
              window._pickerDeadlineSet && window._pickerDeadlineSet(endISO);
            }
          }, 80);
        }
      },

      // ── Theme ──
      themeSystem: 'standard',
    });

    calendar.render();
  }

  // ── Apply a date change (from drag/resize) back to the card DOM + Firestore ──
  function applyDateChange(fcEvent) {
    const cardEl = fcEvent.extendedProps.cardEl;
    if (!cardEl) return;

    const newStart = fcEvent.startStr
      ? fcEvent.startStr.replace('T', ' ').replace(/:[0-9]{2}(\+|Z|$).*/, '')
      : '';
    // FC end for allDay events is exclusive; step back 1 day
    let newEnd = fcEvent.endStr || '';
    if (newEnd && fcEvent.allDay) {
      const d = new Date(newEnd);
      d.setDate(d.getDate() - 1);
      newEnd = d.toISOString().split('T')[0];
    } else if (newEnd) {
      newEnd = newEnd.replace('T', ' ').replace(/:[0-9]{2}(\+|Z|$).*/, '');
    }

    // If FullCalendar gave no end (single-day allDay drag), keep deadline = start
    if (!newEnd && newStart) newEnd = newStart;

    // Update datasets
    if (newStart) cardEl.dataset.startDate = newStart;
    else delete cardEl.dataset.startDate;
    if (newEnd) cardEl.dataset.deadline = newEnd;
    else delete cardEl.dataset.deadline;

    // Rebuild date badge spans on the board card
    updateCardDateSpans(cardEl, newStart, newEnd);

    // Persist to Firestore via saveTask
    if (typeof saveTask === 'function') {
      saveTask(cardEl).catch(() => {});
    }

    if (typeof logActivity === 'function') {
      const author = typeof _authorName === 'function' ? _authorName() : 'Someone';
      const title  = cardEl.dataset.title || '';
      logActivity('edit', `<b>${author}</b> rescheduled <em>${title}</em>`);
    }
  }

  // ── Update date badge spans in a card element ─────────────────────────────
  function updateCardDateSpans(cardEl, newStart, newEnd) {
    cardEl.querySelector('.task__startdate')?.remove();
    cardEl.querySelector('.task__deadline')?.remove();
    let stats = cardEl.querySelector('.task__stats');
    // Create the stats bar if it doesn't exist yet (card had no dates/assignee)
    if (!stats) {
      stats = document.createElement('div');
      stats.className = 'task__stats';
      const anchor = cardEl.querySelector('.task__timeline, .task__footer');
      if (anchor) cardEl.insertBefore(stats, anchor);
      else cardEl.appendChild(stats);
    }
    const fmt = typeof fmtDeadline === 'function' ? fmtDeadline : v => v;
    if (newEnd) {
      const isOD = typeof isOverdue === 'function' && isOverdue(newEnd);
      const dl = document.createElement('span');
      dl.className = `task__deadline${isOD ? ' task__deadline--overdue' : ''}`;
      dl.innerHTML = `<i class="fas fa-flag"></i>${fmt(newEnd)}`;
      stats.prepend(dl);
    }
    if (newStart) {
      const sd = document.createElement('span');
      sd.className = 'task__startdate';
      sd.innerHTML = `<i class="fas fa-play-circle"></i>${fmt(newStart)}`;
      stats.prepend(sd);
    }
  }

  // ── Handle a card dragged from sidebar and dropped onto calendar ──────────
  function applyExternalDrop(info) {
    const cardId   = info.event.id;
    const startStr = (info.event.startStr || '').split('T')[0];
    let endStr = startStr;
    if (info.event.endStr) {
      const d = new Date(info.event.endStr);
      if (info.event.allDay) d.setDate(d.getDate() - 1);
      endStr = d.toISOString().split('T')[0];
    }
    info.event.remove(); // remove the temporary FC event; real one added by reload

    const cardEl = document.querySelector(`.task[data-id="${CSS.escape(cardId)}"]`);
    if (!cardEl) return;

    cardEl.dataset.startDate = startStr;
    cardEl.dataset.deadline  = endStr;
    updateCardDateSpans(cardEl, startStr, endStr);

    if (typeof saveTask === 'function') saveTask(cardEl).catch(() => {});
    reloadCalendarEvents();
  }

  // ── Sidebar: all board cards ──────────────────────────────────────────────
  let draggable = null;

  function buildSidebar(filter) {
    const list = document.getElementById('calSidebarList');
    if (!list) return;
    const query = (filter || '').toLowerCase().trim();
    const allCards = [...document.querySelectorAll('.project-column:not(.project-column--archive):not(.project-column--trash) .task')];
    list.innerHTML = '';
    allCards.forEach(card => {
      const title = card.dataset.title || card.querySelector('p')?.textContent?.trim() || '(Untitled)';
      if (query && !title.toLowerCase().includes(query)) return;
      // ── Tag filter ──
      if (activeTagFilter !== null) {
        const tagClass = [...(card.querySelector('.task__tag')?.classList || [])]
          .find(c => c.startsWith('task__tag--'));
        const cardTag = tagClass ? tagClass.replace('task__tag--', '') : 'task';
        if (cardTag !== activeTagFilter) return;
      }

      const colName = card.closest('.project-column')
        ?.querySelector('.project-column-heading__title')?.textContent?.trim() || '';
      const tagClass = [...(card.querySelector('.task__tag')?.classList || [])]
        .find(c => c.startsWith('task__tag--'));
      const tagId  = tagClass ? tagClass.replace('task__tag--', '') : 'task';
      const color  = getTagColor(tagId);
      const hasDates = !!(card.dataset.startDate || card.dataset.deadline);
      if (hasDates) return; // already on calendar — hide from sidebar

      const el = document.createElement('div');
      el.className = 'cal-sidebar__card';
      el.style.setProperty('--card-color', color);
      el.dataset.id = card.dataset.id;
      el.dataset.event = JSON.stringify({
        id:              card.dataset.id,
        title,
        backgroundColor: color,
        borderColor:     color,
        textColor:       contrastColor(color),
        duration:        { days: 1 }
      });

      // Get tag label
      const tagLabel = window._getActiveTags
        ? (window._getActiveTags().find(t => t.id === tagId)?.label || tagId)
        : tagId;

      el.innerHTML =
        `<div class="cs-card-accent"></div>` +
        `<div class="cs-card-body">` +
          `<div class="cs-card-row">` +
            `<i class="fas fa-grip-vertical cs-drag-handle"></i>` +
            `<span class="cs-title">${title}</span>` +
          `</div>` +
          `<span class="cs-tag-chip"><span class="cs-tag-dot"></span>${tagLabel}</span>` +
        `</div>`;
      list.appendChild(el);
    });
    if (!list.children.length) {
      list.innerHTML = '<p class="cal-sidebar__empty">No unscheduled cards</p>';
    }
  }

  function initDraggable() {
    if (draggable) return;
    const listEl = document.getElementById('calSidebarList');
    if (!listEl || typeof FullCalendar === 'undefined') return;
    draggable = new FullCalendar.Draggable(listEl, {
      itemSelector: '.cal-sidebar__card'
    });
  }

  // ── Unschedule a card (dragged from calendar back to sidebar) ─────────────
  function unscheduleCard(fcEvent) {
    if (fcEvent.extendedProps.isTodo) return;
    const cardEl = fcEvent.extendedProps.cardEl;
    if (!cardEl) return;

    delete cardEl.dataset.startDate;
    delete cardEl.dataset.deadline;
    cardEl.querySelector('.task__startdate')?.remove();
    cardEl.querySelector('.task__deadline')?.remove();

    fcEvent.remove();

    if (typeof saveTask === 'function') saveTask(cardEl).catch(() => {});
    buildSidebar(document.getElementById('calSidebarSearch')?.value || '');
  }

  // ── Reload events into the calendar ──────────────────────────────────────
  function reloadCalendarEvents() {
    if (!calendar) return;
    calendar.removeAllEvents();
    calendar.addEventSource(gatherEvents());
    buildSidebar(document.getElementById('calSidebarSearch')?.value || '');
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  const overlay = document.getElementById('calOverlay');

  function openCalendar() {
    overlay.classList.add('open');
    document.body.classList.add('cal-open');
    buildTagFilter();
    buildSidebar();
    loadFullCalendar(function () {
      if (!calendarInited) {
        // Small delay so the container has layout dimensions
        requestAnimationFrame(() => {
          setTimeout(() => {
            initCalendar();
            initDraggable();
            reloadCalendarEvents();
          }, 30);
        });
      } else {
        calendar.updateSize();
        reloadCalendarEvents();
      }
    });
  }

  function closeCalendar() {
    overlay.classList.remove('open');
    document.body.classList.remove('cal-open');
  }

  // ── Expose reload so board.js / app.js can call it after saves ────────────
  window._reloadCalendarEvents = reloadCalendarEvents;

  // ── Wire up buttons ───────────────────────────────────────────────────────
  document.getElementById('calendarBtn').addEventListener('click', openCalendar);
  document.getElementById('calCloseBtn').addEventListener('click', closeCalendar);

  // Close on overlay backdrop click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeCalendar();
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeCalendar();
  });

  // ── Dark mode sync ─────────────────────────────────────────────────────────
  // FullCalendar uses CSS vars; we drive dark mode via body.dark class
  // No extra work needed — CSS handles it.

  // ── Sidebar search (debounced) ───────────────────────────────────────────
  let _sidebarSearchTimer;
  document.getElementById('calSidebarSearch')
    ?.addEventListener('input', e => {
      clearTimeout(_sidebarSearchTimer);
      _sidebarSearchTimer = setTimeout(() => buildSidebar(e.target.value), 200);
    });

  // ── Expose setter hooks for modal.js date pre-fill on select ──────────────
  // modal.js sets pickerStartDate / pickerDeadline directly; we expose wrappers
  window._pickerStartDateSet = function(iso) {
    // Find the module-scoped pickerStartDate via indirect access
    const input = document.getElementById('cardStartDate');
    if (input) input.value = iso;
    // Try to set the VanillaCalendar value if accessible
  };
  window._pickerDeadlineSet = function(iso) {
    const input = document.getElementById('cardDeadline');
    if (input) input.value = iso;
  };

}());
