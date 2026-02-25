// ── Add Card Modal ────────────────────────────────────────────────────────
(function () {
  const fab     = document.getElementById('fabBtn');
  const overlay = document.getElementById('modalOverlay');
  const cancel  = document.getElementById('modalCancel');
  const addBtn  = document.getElementById('modalAdd');
  const colSel  = document.getElementById('cardColumn');
  const tagSel  = document.getElementById('cardTag');
  const textEl  = document.getElementById('cardText');

  function refreshColSelect() {
    const cols = [...document.querySelectorAll('.project-column')];
    colSel.innerHTML = cols.map((col, i) => {
      const title = col.querySelector('.project-column-heading__title')?.textContent || `Column ${i + 1}`;
      return `<option value="${i}">${title}</option>`;
    }).join('');
  }

  function openModal()  { refreshColSelect(); overlay.classList.add('open'); textEl.focus(); }
  function closeModal() { overlay.classList.remove('open'); textEl.value = ''; }

  fab.addEventListener('click', openModal);
  cancel.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  addBtn.addEventListener('click', () => {
    const text = textEl.value.trim();
    if (!text) { textEl.focus(); return; }

    const tag   = tagSel.value;
    const colEl = document.querySelectorAll('.project-column')[+colSel.value];
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const authorName  = currentUser?.displayName || currentUser?.email || 'You';
    const authorPhoto = currentUser?.photoURL    || '';
    const authorHTML  = authorPhoto
      ? `<img class='tl-avatar' src='${authorPhoto}' alt='${authorName}' title='${authorName}'>`
      : `<span class='tl-avatar tl-avatar--initial' title='${authorName}'>${authorName[0].toUpperCase()}</span>`;

    const card      = document.createElement('div');
    card.className  = 'task';
    card.draggable  = true;
    card.innerHTML  = `
      <div class='task__tags'>
        <span class='task__tag task__tag--${tag}'>${tagLabels[tag]}</span>
        <button class='task__options'><i class='fas fa-ellipsis-h'></i></button>
      </div>
      <p>${text}</p>
      <div class='task__stats'>
        <span><time><i class='fas fa-flag'></i>${today}</time></span>
        <span><i class='fas fa-comment'></i>0</span>
        <span><i class='fas fa-paperclip'></i>0</span>
        <span class='task__owner'>${authorHTML}</span>
      </div>`;

    card.insertAdjacentHTML('beforeend', buildTimeline([
      { type: 'create', author: authorName, authorPhoto, text: 'created this task', date: today }
    ]));

    card.dataset.id             = 'task-' + Date.now();
    card.dataset.created        = new Date().toISOString().split('T')[0];
    card.dataset.createdByUid   = currentUser?.uid         || '';
    card.dataset.createdByName  = authorName;
    card.dataset.createdByPhoto = authorPhoto;
    addUpdateWidget(card);
    refreshExpandBtn(card);

    const zone = colEl.querySelector('.drop-zone');
    zone ? colEl.insertBefore(card, zone) : colEl.appendChild(card);

    logActivity('create', `<b>${authorName}</b> created "${text.slice(0, 40)}" in <b>${colSel.options[colSel.selectedIndex].text}</b>`);
    saveChanges();
    closeModal();
  });
}());
