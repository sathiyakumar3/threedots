// ── Serialize board-level data (name + columns only, no task bodies) ──
function serializeBoard() {
  const sidebar      = document.getElementById('collapsedSidebar');
  const sidebarR     = document.getElementById('collapsedSidebarRight');
  const sidebarCols  = sidebar  ? [...sidebar.querySelectorAll('.project-column')]  : [];
  const sidebarRCols = sidebarR ? [...sidebarR.querySelectorAll('.project-column')] : [];
  const boardCols    = [...document.querySelector('.project-tasks').querySelectorAll('.project-column')];
  const cols = [...sidebarCols, ...sidebarRCols, ...boardCols].sort((a, b) => (+a.dataset.colOrder || 0) - (+b.dataset.colOrder || 0));
  const name = document.querySelector('#boardComboMenu .board-combo__item.active')?.textContent
            || document.getElementById('boardComboLabel')?.textContent
            || 'My Board';
  return {
    name,
    columns: {
      columns: cols.map((col, i) => ({
        id:       +col.dataset.columnId || i,
        title:    col.querySelector('.project-column-heading__title')?.textContent || `Column ${i + 1}`,
        ...(col.dataset.wipLimit ? { wipLimit: +col.dataset.wipLimit } : {}),
        ...(col.classList.contains('project-column--archive')  ? { archive:   true } : {}),
        ...(col.classList.contains('project-column--trash')    ? { trash:     true } : {}),
        ...(col.classList.contains('project-column--collapsed') ? { collapsed: true } : {}),
        ...(col.dataset.colWidth ? { width: +col.dataset.colWidth } : {})
      }))
    }
  };
}

// ── Persist board to Firestore ──
// Tasks are stored as a subcollection: boards/{id}/tasks/{taskId}
function saveChanges(silent) {
  const sidebar      = document.getElementById('collapsedSidebar');
  const sidebarR     = document.getElementById('collapsedSidebarRight');
  const sidebarCols  = sidebar  ? [...sidebar.querySelectorAll('.project-column')]  : [];
  const sidebarRCols = sidebarR ? [...sidebarR.querySelectorAll('.project-column')] : [];
  const boardCols    = [...document.querySelector('.project-tasks').querySelectorAll('.project-column')];
  const cols = [...sidebarCols, ...sidebarRCols, ...boardCols].sort((a, b) => (+a.dataset.colOrder || 0) - (+b.dataset.colOrder || 0));
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
    .catch(err => { console.error('Save failed:', err); showToast('Save failed', true); });
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
    .catch(err => { console.error('Save failed:', err); showToast('Save failed', true); });
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
  const tracks  = [];
  colEls.forEach(col => {
    const sub = parseInt(col.dataset.subcols) || 1;
    col.style.gridColumn = sub > 1 ? `span ${sub}` : '';
    if (col.dataset.colWidth) {
      // Subtract inter-track gaps so the column's total rendered width matches colWidth exactly
      const trackW = Math.round((+col.dataset.colWidth - (sub - 1) * _GRID_GAP) / sub);
      for (let i = 0; i < sub; i++) tracks.push(`${Math.max(trackW, 1)}px`);
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
  const measureTracks = colEls.map(c => c.dataset.colWidth ? `${+c.dataset.colWidth}px` : '1fr');
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
