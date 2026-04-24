// ── Serialize board-level data (name + columns only, no task bodies) ──
function serializeBoard() {
  const barCols   = [...(document.getElementById('collapsedBar')?.querySelectorAll('.project-column') ?? [])];
  const boardCols = [...document.querySelector('.project-tasks').querySelectorAll('.project-column')];
  const cols = [...barCols, ...boardCols].sort((a, b) => (+a.dataset.colOrder || 0) - (+b.dataset.colOrder || 0));
  const name = document.querySelector('#boardComboMenu .board-combo__item.active')?.textContent
            || document.getElementById('boardComboLabel')?.textContent
            || 'My Board';
  return {
    name,
    columns: cols.map((col, i) => ({
      id:       +col.dataset.columnId || i,
      seq:      i,
      title:    col.querySelector('.project-column-heading__title')?.textContent || `Column ${i + 1}`,
      ...(col.dataset.wipLimit ? { wipLimit: +col.dataset.wipLimit } : {}),
      ...(col.classList.contains('project-column--archive')  ? { archive:   true } : {}),
      ...(col.classList.contains('project-column--trash')    ? { trash:     true } : {}),
      // Only persist collapsed:true for non-special columns (archive/trash are always force-collapsed on load)
      ...(!col.classList.contains('project-column--archive') && !col.classList.contains('project-column--trash') && col.classList.contains('project-column--collapsed') ? { collapsed: true } : {}),
      ...(col.dataset.colWidth && !col.classList.contains('project-column--archive') && !col.classList.contains('project-column--trash') ? { width: +col.dataset.colWidth } : {})
    }))
  };
}

// ── Persist board to Firestore ──
// Tasks are stored as a subcollection: boards/{id}/tasks/{taskId}
function saveChanges(silent) {
  const barCols   = [...(document.getElementById('collapsedBar')?.querySelectorAll('.project-column') ?? [])];
  const boardCols = [...document.querySelector('.project-tasks').querySelectorAll('.project-column')];
  const cols = [...barCols, ...boardCols].sort((a, b) => (+a.dataset.colOrder || 0) - (+b.dataset.colOrder || 0));
  const batch = db.batch();

  cols.forEach((col, i) => {
    const columnId = +col.dataset.columnId || i;
    [...col.querySelectorAll(':scope > .task')].forEach((cardEl, order) => {
      const taskData = serializeTask(cardEl);
      const taskId   = taskData.id;
      const taskRef  = db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId);
      batch.set(taskRef, { ...taskData, boardId: BOARD_ID, columnId, order }, { merge: true });
    });
  });

  const boardData = serializeBoard();
  batch.set(db.doc(`boards/${BOARD_ID}`), boardData, { merge: true });

  return batch.commit()
    .then(() => { if (!silent) showToast('Saved ✓'); })
    .catch(() => { showToast('Save failed', true); });
}

// ── Persist a single task card to Firestore (targeted, no full-board batch) ──
function saveTask(cardEl, silent) {
  if (!cardEl) return Promise.resolve();
  const colEl    = cardEl.closest('.project-column');
  const columnId = colEl ? (+colEl.dataset.columnId || 0) : 0;
  const siblings = colEl ? [...colEl.querySelectorAll(':scope > .task')] : [];
  const order    = siblings.indexOf(cardEl);
  const taskData = serializeTask(cardEl);
  const taskId   = taskData.id;
  // Suppress real-time listener echo for our own writes
  window._localWriteIds = window._localWriteIds || new Set();
  window._localWriteIds.add(taskId);
  return db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId)
    .set({ ...taskData, boardId: BOARD_ID, columnId, order }, { merge: true })
    .then(() => {
      setTimeout(() => window._localWriteIds?.delete(taskId), 500);
      if (!silent) showToast('Saved ✓');
    })
    .catch(() => { showToast('Save failed', true); });
}

// ── Inject a column dropdown into an existing column element ──
function setupColDropdown(colEl) {
  const heading = colEl.querySelector('.project-column-heading');
  if (!heading || heading.querySelector('.col-dropdown')) return;
  const isArchive = colEl.classList.contains('project-column--archive');
  const isTrash   = colEl.classList.contains('project-column--trash');
  const isSpecial = isArchive || isTrash;
  const isDone    = +colEl.dataset.columnId === 98;
  colEl.insertAdjacentHTML('beforeend', `<div class='col-resize-handle' title='Drag to resize · Double-click to reset'></div>`);
  const optBtn  = heading.querySelector('.project-column-heading__options');
  const countEl  = heading.querySelector('.col-count');
  const _ins = (html) => countEl
    ? countEl.insertAdjacentHTML('beforebegin', html)
    : heading.insertAdjacentHTML('beforeend', html);
  _ins(`<button class='col-collapse-btn' title='Collapse column'><i class='fas fa-minus'></i></button>`);
  if (!isSpecial && !isDone) {
    _ins(`<span class='col-drag-handle' draggable='true' title='Drag to reorder column'><i class='fas fa-grip-vertical'></i></span>`);
  }
  heading.insertAdjacentHTML('beforeend',
    `<div class='col-dropdown'>
       ${isSpecial ? '' : `<button class='col-opt-rename'><i class='fas fa-pen'></i> Rename</button>`}
       ${isSpecial ? '' : `<button class='col-opt-add-before'><i class='fas fa-arrow-left'></i> Add column before</button>`}
       ${isSpecial || isDone ? '' : `<button class='col-opt-add-after'><i class='fas fa-arrow-right'></i> Add column after</button>`}
       ${isSpecial || isDone ? '' : `<button class='col-opt-wip'><i class='fas fa-tachometer-alt'></i> WIP Limit</button>`}
       <hr class='col-dropdown-sep'>
       <button class='col-opt-collapse'><i class='fas fa-compress-alt'></i> Collapse column</button>
       ${isTrash ? `<button class='col-opt-empty-trash danger'><i class='fas fa-fire-alt'></i> Empty Trash</button>` : ''}
       ${isSpecial || isDone ? '' : `<button class='col-opt-delete danger'><i class='fas fa-trash-alt'></i> Delete column</button>`}
     </div>`);
  if (isTrash) {
    colEl.insertAdjacentHTML('beforeend',
      `<p class='trash-col-notice'><i class='fas fa-clock'></i> All cards are automatically purged after 30 days</p>`);
  }
}

// ── Keep the CSS grid in sync with the number of visible columns (+ sub-col spans) ──
const _GRID_GAP = 16; // matches grid-column-gap: 1rem in CSS
function syncGrid() {
  const board   = document.querySelector('.project-tasks');
  const colEls  = [...board.querySelectorAll('.project-column:not(.project-column--archive):not(.project-column--trash)')];
  const showArc = board.classList.contains('show-archive');
  const showTrsh= board.classList.contains('show-trash');

  // ── Clamp fixed-width columns so total tracks never exceed available board width ──
  const boardW        = board.clientWidth || window.innerWidth;
  const fixedCols     = colEls.filter(c => c.dataset.colWidth);
  const fluidCount    = colEls.length - fixedCols.length
                        + (showArc  && board.querySelector('.project-column--archive')  ? 1 : 0)
                        + (showTrsh && board.querySelector('.project-column--trash')    ? 1 : 0);
  const minFluidSpace = fluidCount * _SUBCOL_MIN_W;
  const totalFixed    = fixedCols.reduce((s, c) => s + +c.dataset.colWidth, 0);
  if (totalFixed + minFluidSpace > boardW) {
    // Scale all fixed widths down proportionally so they fit
    const scale = (boardW - minFluidSpace) / totalFixed;
    fixedCols.forEach(c => {
      const clamped = Math.max(_SUBCOL_MIN_W, Math.round(+c.dataset.colWidth * scale));
      c.dataset.colWidth = clamped;
    });
  }

  const tracks  = [];
  colEls.forEach(col => {
    const sub = parseInt(col.dataset.subcols) || 1;
    col.style.gridColumn = sub > 1 ? `span ${sub}` : '';
    if (col.dataset.colWidth) {
      // Use minmax so the column can shrink if viewport narrows, but won't overflow
      const trackW = Math.round((+col.dataset.colWidth - (sub - 1) * _GRID_GAP) / sub);
      for (let i = 0; i < sub; i++) tracks.push(`minmax(${_SUBCOL_MIN_W}px, ${Math.max(trackW, _SUBCOL_MIN_W)}px)`);
    } else {
      for (let i = 0; i < sub; i++) tracks.push('1fr');
    }
  });
  if (showArc) {
    const arc = board.querySelector('.project-column--archive');
    if (arc) { arc.style.gridColumn = ''; tracks.push('1fr'); }
  }
  if (showTrsh) {
    const trsh = board.querySelector('.project-column--trash');
    if (trsh) { trsh.style.gridColumn = ''; tracks.push('1fr'); }
  }
  board.style.gridTemplateColumns = tracks.length ? tracks.join(' ') : '';
}

// ── Distribute overflow cards into CSS sub-columns when content exceeds viewport ──
// Minimum card width to determine how many sub-columns fit: SUBCOL_MIN_W px
const _SUBCOL_MIN_W = 300;
window._SUBCOL_MIN_W = _SUBCOL_MIN_W;

function checkColumnOverflow() {
  const board = document.querySelector('.project-tasks');
  if (!board) return;
  // Collapsed columns live in the sidebar — only process active board columns
  const colEls = [...board.querySelectorAll('.project-column:not(.project-column--archive):not(.project-column--trash)')];
  if (!colEls.length) return;

  // 1. Reset sub-col state; keep colWidth so the measurement grid reflects manual sizes
  colEls.forEach(c => { delete c.dataset.subcols; c.style.gridColumn = ''; });
  const showArc  = board.classList.contains('show-archive');
  const showTrsh = board.classList.contains('show-trash');
  const measureTracks = colEls.map(c => c.dataset.colWidth ? `minmax(${_SUBCOL_MIN_W}px, ${+c.dataset.colWidth}px)` : '1fr');
  if (showArc  && board.querySelector('.project-column--archive'))  measureTracks.push('1fr');
  if (showTrsh && board.querySelector('.project-column--trash'))    measureTracks.push('1fr');
  board.style.gridTemplateColumns = measureTracks.join(' ');
  void board.offsetHeight; // synchronous reflow

  // 2. Available viewport height
  const topbarH = document.querySelector('.project-info')?.offsetHeight ?? 56;
  const availH  = window.innerHeight - topbarH - 48;

  // 3. Per-column: maxSubs based on that column's own rendered width
  colEls.forEach(col => {
    const heading  = col.querySelector('.project-column-heading');
    const headingH = heading?.offsetHeight ?? 52;
    const cardsH   = [...col.querySelectorAll(':scope > .task')]
                       .reduce((s, c) => s + c.offsetHeight + 9, 0);
    const totalH   = headingH + cardsH + 24;
    if (totalH > availH) {
      const colW    = col.getBoundingClientRect().width;
      const maxSubs = Math.max(1, Math.min(4, Math.floor(colW / _SUBCOL_MIN_W)));
      const sub     = Math.min(maxSubs, Math.ceil(totalH / availH));
      if (sub > 1) col.dataset.subcols = sub;
    }
  });

  syncGrid();
}

let _overflowCheckTimer = null;
function scheduleOverflowCheck() {
  clearTimeout(_overflowCheckTimer);
  _overflowCheckTimer = setTimeout(checkColumnOverflow, 150);
}

// ── Off-screen column detector ───────────────────────────────────────────────
// Checks whether the board grid is wider than its scroll container can handle
// (i.e. columns are genuinely unrenderable, not just scrolled out of view).
let _offScreenToastTimer = null;
function checkColumnsOffScreen() {
  if (!window._boardLayoutReady) return;
  const body = document.querySelector('.project-body');
  const board = document.querySelector('.project-tasks');
  if (!body || !board) return;
  // A column is truly inaccessible only when the grid's minimum possible width
  // (sum of minmax minimums) already exceeds what the scroll container can provide.
  const cols = [...board.querySelectorAll('.project-column')];
  if (!cols.length) return;
  // Each column must fit at least _SUBCOL_MIN_W; if total minimum > container width
  // there is a real overflow that scrolling alone cannot resolve.
  const containerW = body.clientWidth;
  const totalMinW  = cols.length * _SUBCOL_MIN_W;
  if (totalMinW > containerW) {
    clearTimeout(_offScreenToastTimer);
    _offScreenToastTimer = setTimeout(() => {
      showToast(`⚠️ Too many columns to fit — try collapsing some.`, true);
    }, 400);
  }
}
window.addEventListener('resize', () => { clearTimeout(_offScreenToastTimer); _offScreenToastTimer = setTimeout(checkColumnsOffScreen, 300); });

// ── Auto-fit: distribute available board width equally across all columns ──
function autoResizeColumns() {
  const body  = document.querySelector('.project-body');
  const board = document.querySelector('.project-tasks');
  if (!body || !board) return;

  // Include archive/trash only when they are currently visible
  const showArc  = board.classList.contains('show-archive');
  const showTrsh = board.classList.contains('show-trash');
  const cols = [...board.querySelectorAll('.project-column')].filter(col => {
    if (col.classList.contains('project-column--archive')) return showArc;
    if (col.classList.contains('project-column--trash'))   return showTrsh;
    return true;
  });
  if (!cols.length) return;

  // Account for sidebar widths and board padding
  const sidebarL = document.getElementById('collapsedSidebar')?.offsetWidth  || 0;
  const sidebarR = document.getElementById('collapsedSidebarRight')?.offsetWidth || 0;
  const boardPad = 32; // 1rem padding each side
  const gapTotal = (cols.length - 1) * (_GRID_GAP || 16);
  const available = body.clientWidth - sidebarL - sidebarR - boardPad - gapTotal;
  const colW = Math.max(_SUBCOL_MIN_W, Math.floor(available / cols.length));

  cols.forEach(col => {
    col.dataset.colWidth = colW;
  });

  syncGrid();
  scheduleOverflowCheck();
  saveChanges(true);
  showToast('Columns auto-fitted ✓');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('autoResizeColsBtn')?.addEventListener('click', autoResizeColumns);
});
