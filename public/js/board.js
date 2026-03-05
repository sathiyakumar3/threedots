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

// ── Keep the CSS grid in sync with the number of visible columns ──
function syncGrid() {
  const board   = document.querySelector('.project-tasks');
  const regular = board.querySelectorAll('.project-column:not(.project-column--archive)').length;
  const showArc = board.classList.contains('show-archive');
  board.style.gridTemplateColumns = `repeat(${regular + (showArc ? 1 : 0)}, 1fr)`;
}
