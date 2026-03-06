// ── Serialize board-level data (name + columns only, no task bodies) ──
function serializeBoard() {
  const cols = [...document.querySelector('.project-tasks').querySelectorAll('.project-column')];
  const name = document.querySelector('#boardComboMenu .board-combo__item.active')?.textContent
            || document.getElementById('boardComboLabel')?.textContent
            || 'My Board';
  return {
    name,
    columns: {
      columns: cols.map((col, i) => ({
        id:       +col.dataset.columnId || i,
        title:    col.querySelector('.project-column-heading__title')?.textContent || `Column ${i + 1}`,
        owner:    col.dataset.owner || '',
        users:    col.dataset.users ? JSON.parse(col.dataset.users) : [],
        ...(col.classList.contains('project-column--archive') ? { archive: true } : {})
      }))
    }
  };
}

// ── Persist board to Firestore ──
// Tasks are stored as a subcollection: boards/{id}/tasks/{taskId}
function saveChanges(silent) {
  const cols  = [...document.querySelector('.project-tasks').querySelectorAll('.project-column')];
  const batch = db.batch();

  cols.forEach((col, i) => {
    const columnId = +col.dataset.columnId || i;
    [...col.querySelectorAll(':scope > .task')].forEach((cardEl, order) => {
      const { id: taskId, ...taskFields } = serializeTask(cardEl);
      const taskRef = db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId);
      batch.set(taskRef, { ...taskFields, boardId: BOARD_ID, columnId, order }, { merge: true });
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
  const { id: taskId, ...taskFields } = serializeTask(cardEl);
  return db.collection(`boards/${BOARD_ID}/tasks`).doc(taskId)
    .set({ ...taskFields, boardId: BOARD_ID, columnId, order }, { merge: true })
    .then(() => { if (!silent) showToast('Saved ✓'); })
    .catch(err => { console.error('Save failed:', err); showToast('Save failed', true); });
}

// ── Inject a column dropdown into an existing column element ──
function setupColDropdown(colEl) {
  const heading = colEl.querySelector('.project-column-heading');
  if (!heading || heading.querySelector('.col-dropdown')) return;
  const isArchive = colEl.classList.contains('project-column--archive');
  const isDone    = +colEl.dataset.columnId === 98;
  heading.insertAdjacentHTML('beforeend',
    `<div class='col-dropdown'>
       ${isArchive ? '' : `<button class='col-opt-rename'><i class='fas fa-pen'></i> Rename</button>`}
       ${isArchive ? '' : `<button class='col-opt-add-before'><i class='fas fa-arrow-left'></i> Add column before</button>`}
       ${isArchive || isDone ? '' : `<button class='col-opt-add-after'><i class='fas fa-arrow-right'></i> Add column after</button>`}
       ${isArchive || isDone ? '' : `<button class='col-opt-delete danger'><i class='fas fa-trash-alt'></i> Delete column</button>`}
     </div>`);
}

// ── Keep the CSS grid in sync with the number of visible columns (+ sub-col spans) ──
function syncGrid() {
  const board   = document.querySelector('.project-tasks');
  const colEls  = [...board.querySelectorAll('.project-column:not(.project-column--archive)')];
  const showArc = board.classList.contains('show-archive');
  let totalCells = 0;
  colEls.forEach(col => {
    const sub = parseInt(col.dataset.subcols) || 1;
    col.style.gridColumn = sub > 1 ? `span ${sub}` : '';
    totalCells += sub;
  });
  if (showArc) {
    const arc = board.querySelector('.project-column--archive');
    if (arc) arc.style.gridColumn = '';
    totalCells += 1;
  }
  board.style.gridTemplateColumns = `repeat(${totalCells}, 1fr)`;
}

// ── Distribute overflow cards into CSS sub-columns when content exceeds viewport ──
// Minimum card width to determine how many sub-columns fit: SUBCOL_MIN_W px
const _SUBCOL_MIN_W = 300;

function checkColumnOverflow() {
  const board = document.querySelector('.project-tasks');
  if (!board) return;
  const colEls = [...board.querySelectorAll('.project-column:not(.project-column--archive)')];
  if (!colEls.length) return;

  // 1. Reset sub-col state so we measure natural single-column heights
  colEls.forEach(c => { delete c.dataset.subcols; c.style.gridColumn = ''; });
  const showArc = board.classList.contains('show-archive');
  board.style.gridTemplateColumns = `repeat(${colEls.length + (showArc ? 1 : 0)}, 1fr)`;
  void board.offsetHeight; // synchronous reflow to get accurate measurements

  // 2. Calculate available space
  const topbarH = document.querySelector('.project-info')?.offsetHeight ?? 56;
  const availH  = window.innerHeight - topbarH - 48;
  const numCols = colEls.length;
  // Max sub-columns an expanding column can have:
  // take total board width, reserve one minimum-width slot for every OTHER column,
  // then see how many 300px sub-columns fit in the remainder.
  // e.g. 1800px board, 3 cols → floor((1800 - 2×300) / 300) = 4
  //      1400px board, 2 cols → floor((1400 - 1×300) / 300) = 3
  const maxSubs = Math.max(1, Math.min(4, Math.floor(
    (board.clientWidth - (numCols - 1) * _SUBCOL_MIN_W) / _SUBCOL_MIN_W
  )));

  // 3. For each column, measure natural height and decide how many sub-cols are needed
  colEls.forEach(col => {
    const heading  = col.querySelector('.project-column-heading');
    const headingH = heading?.offsetHeight ?? 52;
    const cardsH   = [...col.querySelectorAll(':scope > .task')]
                       .reduce((s, c) => s + c.offsetHeight + 9, 0);
    const totalH   = headingH + cardsH + 24;
    if (totalH > availH && maxSubs > 1) {
      const sub = Math.min(maxSubs, Math.ceil(totalH / availH));
      col.dataset.subcols = sub;
      if (heading) heading.dataset.subcolsLabel = `${sub} cols`;
    } else {
      if (heading) delete heading.dataset.subcolsLabel;
    }
  });

  syncGrid();
}

let _overflowCheckTimer = null;
function scheduleOverflowCheck() {
  clearTimeout(_overflowCheckTimer);
  _overflowCheckTimer = setTimeout(checkColumnOverflow, 150);
}
