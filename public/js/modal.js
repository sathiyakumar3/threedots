// ── Add Card Modal ────────────────────────────────────────────────────────
(function () {
  const fab         = document.getElementById('fabBtn');
  const overlay     = document.getElementById('modalOverlay');
  const cancel      = document.getElementById('modalCancel');
  const addBtn      = document.getElementById('modalAdd');
  const colTrigger  = document.getElementById('colComboTrigger');
  const colMenu     = document.getElementById('colComboMenu');
  const colList     = document.getElementById('colComboList');
  const colLabel    = document.getElementById('colComboLabel');
  const colNewInput = document.getElementById('colNewInput');
  const colNewAdd   = document.getElementById('colNewAdd');
  const tagWrap     = document.getElementById('cardTag');
  const textEl      = document.getElementById('cardText');
  const todoInput   = document.getElementById('cardTodoInput');
  const todoAddBtn  = document.getElementById('cardTodoAdd');
  const todoList    = document.getElementById('cardTodoList');
  const linkInput   = document.getElementById('cardLink');
  const deadlineInput          = document.getElementById('cardDeadline');
  const assigneeComboTrigger   = document.getElementById('assigneeComboTrigger');
  const assigneeComboMenu      = document.getElementById('assigneeComboMenu');
  const assigneeComboLabel     = document.getElementById('assigneeComboLabel');
  let selectedAssignees = new Set();

  // ── Vanilla Calendar Pro ──
  let pickerDeadline = '';   // ISO yyyy-mm-dd
  let deadlinePicker = null;
  function initDeadlinePicker() {
    if (deadlinePicker || !window.VanillaCalendarPro) return;
    const { Calendar } = window.VanillaCalendarPro;
    deadlinePicker = new Calendar('#cardDeadline', {
      inputMode: true,
      selectedTheme: 'light',
      positionToInput: ['bottom', 'center'],
      selectionTimeMode: 24,
      onChangeToInput(self) {
        const date = self.context.selectedDates[0] || '';
        const time = self.context.selectedTime || '';
        pickerDeadline = date ? (time ? date + ' ' + time : date) : '';
        if (self.context.inputElement) {
          self.context.inputElement.value = pickerDeadline;
        }
      },
    });
    deadlinePicker.init();
  }

  let selectedColIdx = 0;
  let _editingCard = null;

  // ── Column combo ──
  function deleteColumn(col, refreshAfterIdx) {
    const taskCount = col.querySelectorAll(':scope > .task').length;
    if (taskCount > 0) {
      Swal.fire({ title: 'Column not empty', text: `Move or delete the ${taskCount} card${taskCount > 1 ? 's' : ''} before deleting this column.`, icon: 'warning', confirmButtonColor: '#e05252' });
      return;
    }
    const colTitle = col.querySelector('.project-column-heading__title')?.textContent || 'this column';
    Swal.fire({
      title: 'Are you sure?',
      text: `"${colTitle}" will be permanently deleted.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#e05252',
      cancelButtonText: 'Cancel',
      reverseButtons: true
    }).then(result => {
      if (!result.isConfirmed) return;
      col.remove();
      syncGrid();
      saveChanges();
      refreshColCombo(Math.max(0, refreshAfterIdx - 1));
    });
  }

  function refreshColCombo(selectIdx) {
    const cols = [...document.querySelectorAll('.project-column')];
    colList.innerHTML = '';
    cols.forEach((col, i) => {
      const title     = col.querySelector('.project-column-heading__title')?.textContent || `Column ${i + 1}`;
      const colId     = +col.dataset.columnId;
      const canDelete = colId !== 98 && colId !== 99 && cols.length > 1;

      const row = document.createElement('div');
      row.className = 'col-combo__row' + (i === (selectIdx ?? selectedColIdx) ? ' active-row' : '');

      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'board-combo__item' + (i === (selectIdx ?? selectedColIdx) ? ' active' : '');
      btn.textContent = title;
      btn.dataset.idx = i;
      btn.addEventListener('click', () => {
        selectedColIdx = i;
        colLabel.textContent = title;
        colList.querySelectorAll('.board-combo__item').forEach(b => b.classList.toggle('active', +b.dataset.idx === i));
        colList.querySelectorAll('.col-combo__row').forEach(r => r.classList.toggle('active-row', +r.querySelector('.board-combo__item')?.dataset.idx === i));
        colMenu.classList.remove('open');
        colTrigger.classList.remove('open');
      });

      row.appendChild(btn);

      if (canDelete) {
        const del = document.createElement('button');
        del.type      = 'button';
        del.className = 'tags-del-btn';
        del.title     = 'Delete column';
        del.innerHTML = '<i class="fas fa-times"></i>';
        del.addEventListener('click', e => { e.stopPropagation(); deleteColumn(col, i); });
        row.appendChild(del);
      }

      colList.appendChild(row);
    });
    if (selectIdx !== undefined) selectedColIdx = selectIdx;
    const active = colList.querySelector(`.board-combo__item[data-idx="${selectedColIdx}"]`);
    colLabel.textContent = active ? active.textContent : (colList.querySelector('.board-combo__item')?.textContent || 'Select column');
  }

  colTrigger.addEventListener('click', e => {
    e.stopPropagation();
    const open = colMenu.classList.toggle('open');
    colTrigger.classList.toggle('open', open);
    assigneeComboMenu.classList.remove('open');
    assigneeComboTrigger.classList.remove('open');
  });
  colMenu.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => {
    colMenu.classList.remove('open');
    colTrigger.classList.remove('open');
    assigneeComboMenu.classList.remove('open');
    assigneeComboTrigger.classList.remove('open');
  });

  function updateAssigneeLabel() {
    const arr = [...selectedAssignees];
    if (arr.length === 0) {
      assigneeComboLabel.textContent = 'Unassigned';
      assigneeComboLabel.classList.add('assignee-placeholder');
    } else if (arr.length === 1) {
      assigneeComboLabel.textContent = arr[0];
      assigneeComboLabel.classList.remove('assignee-placeholder');
    } else {
      assigneeComboLabel.textContent = arr.length + ' assigned';
      assigneeComboLabel.classList.remove('assignee-placeholder');
    }
  }

  function refreshAssigneeCombo() {
    const names = [];
    const ownerName = document.getElementById('navUserName')?.textContent?.trim();
    if (ownerName) names.push(ownerName);
    document.querySelectorAll('#projectParticipants .participant-avatar').forEach(av => {
      const n = av.querySelector('.pcard__name')?.textContent?.trim();
      if (n && !names.includes(n)) names.push(n);
    });
    assigneeComboMenu.innerHTML = '';
    const clearEl = document.createElement('div');
    clearEl.className = 'board-combo__item assignee-none';
    clearEl.textContent = '— Clear all —';
    clearEl.addEventListener('click', () => {
      selectedAssignees.clear();
      updateAssigneeLabel();
      assigneeComboMenu.querySelectorAll('.assignee-check').forEach(i => i.style.visibility = 'hidden');
    });
    assigneeComboMenu.appendChild(clearEl);
    names.forEach(name => {
      const item = document.createElement('div');
      item.className = 'board-combo__item assignee-item';
      const check = document.createElement('i');
      check.className = 'fas fa-check assignee-check';
      check.style.visibility = selectedAssignees.has(name) ? 'visible' : 'hidden';
      item.appendChild(check);
      const avatarWrap = document.createElement('span');
      avatarWrap.className = 'assignee-item__avatar';
      avatarWrap.innerHTML = resolveAssigneeAvatar(name);
      item.appendChild(avatarWrap);
      item.appendChild(document.createTextNode(name));
      item.addEventListener('click', () => {
        if (selectedAssignees.has(name)) {
          selectedAssignees.delete(name);
          check.style.visibility = 'hidden';
        } else {
          selectedAssignees.add(name);
          check.style.visibility = 'visible';
        }
        updateAssigneeLabel();
      });
      assigneeComboMenu.appendChild(item);
    });
  }

  assigneeComboTrigger.addEventListener('click', e => {
    e.stopPropagation();
    const open = assigneeComboMenu.classList.toggle('open');
    assigneeComboTrigger.classList.toggle('open', open);
    colMenu.classList.remove('open');
    colTrigger.classList.remove('open');
    if (open) refreshAssigneeCombo();
  });
  assigneeComboMenu.addEventListener('click', e => e.stopPropagation());

  function addNewColumn(title) {
    if (!title) { colNewInput.focus(); return; }
    const cols  = [...document.querySelectorAll('.project-column')];
    const ids   = cols.map(c => +c.dataset.columnId).filter(id => id < 98);
    const newId = (ids.length ? Math.max(...ids) : 3) + 1;
    const newCol = document.createElement('div');
    newCol.className = 'project-column';
    newCol.dataset.columnId = newId;
    if (typeof currentUser !== 'undefined' && currentUser) {
      newCol.dataset.owner = currentUser.uid;
      newCol.dataset.users = JSON.stringify([currentUser.uid]);
    }
    newCol.innerHTML = `<div class='project-column-heading'><h2 class='project-column-heading__title'>${title}</h2><button class='project-column-heading__options'><i class="fas fa-ellipsis-h"></i></button></div>`;
    const doneCol = document.querySelector('.project-column[data-column-id="98"]');
    const boardEl = document.querySelector('.project-tasks');
    if (doneCol) boardEl.insertBefore(newCol, doneCol);
    else         boardEl.appendChild(newCol);
    setupColDropdown(newCol);
    syncGrid();
    saveChanges(true);
    colNewInput.value = '';
    const newIdx = [...document.querySelectorAll('.project-column')].indexOf(newCol);
    refreshColCombo(newIdx);
    colMenu.classList.remove('open');
    colTrigger.classList.remove('open');
  }

  colNewAdd.addEventListener('click', () => addNewColumn(colNewInput.value.trim()));
  colNewInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addNewColumn(colNewInput.value.trim()); } });

  window._refreshColCombo = refreshColCombo;

  // ── Todo management ──
  let pendingTodos = [];

  function renderTodoList() {
    todoList.innerHTML = pendingTodos.map((t, i) =>
      `<div class='modal-todo-item'>
         <input type='checkbox' ${t.done ? 'checked' : ''} data-idx='${i}'>
         <span title='${t.text}'>${t.text}</span>
         <button class='modal-todo-item__del' data-idx='${i}' title='Remove'><i class='fas fa-times'></i></button>
       </div>`
    ).join('');
    todoList.querySelectorAll('input[type=checkbox]').forEach(cb =>
      cb.addEventListener('change', e => { pendingTodos[+e.target.dataset.idx].done = e.target.checked; })
    );
    todoList.querySelectorAll('.modal-todo-item__del').forEach(btn =>
      btn.addEventListener('click', e => {
        pendingTodos.splice(+e.currentTarget.dataset.idx, 1);
        renderTodoList();
      })
    );
  }

  function addTodoItem() {
    const val = todoInput.value.trim();
    if (!val) return;
    pendingTodos.push({ text: val, done: false });
    todoInput.value = '';
    renderTodoList();
    todoInput.focus();
  }

  todoAddBtn.addEventListener('click', addTodoItem);
  todoInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTodoItem(); } });

  function getTagPicker() { return tagWrap.querySelector('.tag-picker'); }

  function openModal() {
    initDeadlinePicker();
    refreshColCombo(0);
    refreshAssigneeCombo();
    const tags = window._getActiveTags ? window._getActiveTags() : [];
    if (window._createTagPicker) window._createTagPicker(tags[0]?.id || 'task', tagWrap);
    overlay.classList.add('open');
    textEl.focus();
  }
  function closeModal() {
    _editingCard = null;
    addBtn.innerHTML = '<i class="fas fa-plus"></i> Add Card';
    document.getElementById('modalTitle').textContent = 'Add New Card';
    overlay.classList.remove('open');
    document.getElementById('modalMoreFields')?.classList.remove('open');
    document.getElementById('modalMoreToggle')?.classList.remove('open');
    textEl.value  = '';
    linkInput.value = '';
    deadlineInput.value = '';
    pickerDeadline = '';
    selectedAssignees.clear();
    updateAssigneeLabel();
    pendingTodos  = [];
    todoList.innerHTML = '';
  }

  function openEditModal(cardEl) {
    if (typeof serializeTask !== 'function') return;
    const data = serializeTask(cardEl);
    _editingCard = cardEl;
    initDeadlinePicker();
    const cols   = [...document.querySelectorAll('.project-column')];
    const colIdx = cols.indexOf(cardEl.closest('.project-column'));
    refreshColCombo(colIdx >= 0 ? colIdx : 0);
    refreshAssigneeCombo();
    if (window._createTagPicker) window._createTagPicker(data.tag || 'task', tagWrap);
    // Auto-expand More Options when editing an existing card
    document.getElementById('modalMoreFields')?.classList.add('open');
    document.getElementById('modalMoreToggle')?.classList.add('open');
    textEl.value        = data.text     || '';
    linkInput.value     = data.link     || '';
    pickerDeadline      = data.deadline || '';
    deadlineInput.value = data.deadline || '';
    selectedAssignees.clear();
    if (data.assignee) data.assignee.split(', ').forEach(n => selectedAssignees.add(n.trim()));
    updateAssigneeLabel();
    pendingTodos = (data.todos || []).map(t => ({ text: t.text, done: !!t.done }));
    renderTodoList();
    addBtn.innerHTML = '<i class="fas fa-check"></i> Save Changes';
    document.getElementById('modalTitle').textContent = 'Edit Card';
    overlay.classList.add('open');
    textEl.focus();
  }
  window._openEditModal = openEditModal;

  fab.addEventListener('click', openModal);
  cancel.addEventListener('click', closeModal);
  document.getElementById('modalMoreToggle')?.addEventListener('click', () => {
    const fields = document.getElementById('modalMoreFields');
    const btn    = document.getElementById('modalMoreToggle');
    const isOpen = fields.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
  });
  let _overlayMousedownOnSelf = false;
  overlay.addEventListener('mousedown', e => { _overlayMousedownOnSelf = e.target === overlay; });
  overlay.addEventListener('click', e => { if (e.target === overlay && _overlayMousedownOnSelf) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  addBtn.addEventListener('click', () => {
    const text = textEl.value.trim();
    if (!text) { textEl.focus(); return; }

    const tag      = getTagPicker()?.dataset.value || 'task';
    const todos    = pendingTodos.slice();
    const link     = linkInput.value.trim();
    const deadline = pickerDeadline;
    const assignee = [...selectedAssignees].join(', ');

    // ── Edit existing card ──
    if (_editingCard) {
      const card = _editingCard;
      card.querySelector('p').textContent = text;
      const tagSpan = card.querySelector('.task__tag');
      tagSpan.className   = `task__tag task__tag--${tag}`;
      tagSpan.textContent = tagLabels[tag];
      card.querySelector('.task__todos')?.remove();
      const newTodosHTML = todos.length ? buildTodosHTML(todos) : '';
      if (newTodosHTML) card.querySelector('p').insertAdjacentHTML('afterend', newTodosHTML);
      card.querySelector('.task__link')?.remove();
      if (link) {
        const anchor = card.querySelector('.task__todos') || card.querySelector('p');
        anchor.insertAdjacentHTML('afterend',
          `<div class='task__link'><a href='${link}' target='_blank' rel='noopener'><i class='fas fa-link'></i>${shortLinkLabel(link)}</a></div>`);
      }
      // Update deadline span
      card.querySelector('.task__deadline, .task__no-value:not(.task__no-assignee)')?.remove();
      let stats = card.querySelector('.task__stats');
      const newDeadline = deadline;
      const newAssignee = assignee;
      // Rebuild stats from scratch with the conditional-placeholder logic
      if (!stats) {
        const anchor = card.querySelector('.task__timeline, .task__footer');
        stats = document.createElement('div');
        stats.className = 'task__stats';
        card.insertBefore(stats, anchor);
      }
      card.querySelector('.task__assignees, .task__no-assignee')?.remove();
      stats.querySelector('.task__deadline, .task__no-value:not(.task__no-assignee)')?.remove();
      const dlHTML = newDeadline
        ? `<span class='task__deadline${isOverdue(newDeadline) ? ' task__deadline--overdue' : ''}'><i class='fas fa-calendar-alt'></i>${fmtDeadline(newDeadline)}</span>`
        : (newAssignee ? `<span class='task__no-value'><i class='fas fa-calendar-alt'></i>No Deadline</span>` : '');
      const asnHTML = newAssignee
        ? `<span class='task__assignees'>${newAssignee.split(', ').map(n => resolveAssigneeAvatar(n.trim())).join('')}</span>`
        : (newDeadline ? `<span class='task__no-value task__no-assignee'><i class='fas fa-user'></i>No Assignee</span>` : '');
      if (dlHTML || asnHTML) {
        stats.insertAdjacentHTML('afterbegin', dlHTML);
        stats.insertAdjacentHTML('beforeend', asnHTML);
      } else {
        stats.remove();
      }
      if (newDeadline) card.dataset.deadline = newDeadline; else delete card.dataset.deadline;
      if (newAssignee) card.dataset.assignee = newAssignee; else delete card.dataset.assignee;
      logActivity('edit', `<b>${currentUser?.displayName || 'Someone'}</b> edited "${text.slice(0, 40)}"`);
      saveChanges();
      closeModal();
      return;
    }

    // ── Create new card ──
    const colEl    = document.querySelectorAll('.project-column')[selectedColIdx];
    const today    = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const authorName  = currentUser?.displayName || currentUser?.email || 'You';
    const authorPhoto = currentUser?.photoURL    || '';
    const authorHTML  = authorPhoto
      ? `<img class='tl-avatar' src='${authorPhoto}' alt='${authorName}' title='${authorName}'>`
      : `<span class='tl-avatar tl-avatar--initial' title='${authorName}'>${authorName[0].toUpperCase()}</span>`;

    const todosHTML = todos.length
      ? buildTodosHTML(todos)
      : '';
    const linkHTML = link
      ? `<div class='task__link'><a href='${link}' target='_blank' rel='noopener'><i class='fas fa-link'></i>${shortLinkLabel(link)}</a></div>`
      : '';

    const hasDeadline = !!deadline;
    const hasAssignee  = !!assignee;
    const flagSpanHTML = hasDeadline
      ? `<span class='task__deadline${isOverdue(deadline) ? ' task__deadline--overdue' : ''}'><i class='fas fa-calendar-alt'></i>${fmtDeadline(deadline)}</span>`
      : (hasAssignee ? `<span class='task__no-value'><i class='fas fa-calendar-alt'></i>No Deadline</span>` : '');
    const assigneeTagsHTML = hasAssignee
      ? `<span class='task__assignees'>${assignee.split(', ').map(n => resolveAssigneeAvatar(n.trim())).join('')}</span>`
      : (hasDeadline ? `<span class='task__no-value task__no-assignee'><i class='fas fa-user'></i>No Assignee</span>` : '');
    const statsHTML = (flagSpanHTML || assigneeTagsHTML)
      ? `<div class='task__stats'>${flagSpanHTML}${assigneeTagsHTML}</div>`
      : '';
    const card      = document.createElement('div');
    card.className  = 'task';
    card.draggable  = true;
    card.innerHTML  = `
      <div class='task__tags'>
        <span class='task__tag task__tag--${tag}'>${tagLabels[tag]}</span>
        <button class='task__options'><i class='fas fa-ellipsis-h'></i></button>
      </div>
      <p>${text}</p>
      ${todosHTML}
      ${linkHTML}
      ${statsHTML}`;

    card.dataset.id             = 'task-' + Date.now();
    card.dataset.created        = new Date().toISOString().split('T')[0];
    card.dataset.createdByUid   = currentUser?.uid         || '';
    card.dataset.createdByName  = authorName;
    card.dataset.createdByPhoto = authorPhoto;
    if (deadline) card.dataset.deadline = deadline;
    if (assignee) card.dataset.assignee = assignee;
    addUpdateWidget(card);
    // Insert "created by" timeline entry (always last → visible when collapsed)
    const createdDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const createTL = buildTimeline([{ type: 'create', author: authorName, authorPhoto: authorPhoto, text: 'Card Created', date: createdDate }], { createOnly: true });
    card.querySelector('.task__footer').insertAdjacentHTML('beforebegin', createTL);
    refreshExpandBtn(card);

    const zone = colEl.querySelector('.drop-zone');
    zone ? colEl.insertBefore(card, zone) : colEl.appendChild(card);

    logActivity('create', `<b>${authorName}</b> created "${text.slice(0, 40)}" in <b>${colLabel.textContent}</b>`);
    saveChanges(true);
    closeModal();
  });
}());
