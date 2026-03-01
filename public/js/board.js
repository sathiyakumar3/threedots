// ── Serialize the entire board DOM to a plain object for Firestore ──
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
    },
    tasks: {
      columns: cols.map((col, i) => ({
        id:    +col.dataset.columnId || i,
        tasks: [...col.querySelectorAll(':scope > .task')].map(serializeTask)
      }))
    }
  };
}

// ── Persist board to Firestore ──
function saveChanges(silent) {
  return db.doc(`boards/${BOARD_ID}`).set(serializeBoard(), { merge: true })
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
