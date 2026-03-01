// ── Short display label for a URL ──
function shortLinkLabel(url) {
  try {
    let host = new URL(url).hostname;
    host = host.replace(/^www\./, '');
    host = host.replace(/\.[^.]+$/, '');
    return host || url;
  } catch (e) { return url; }
}

// ── Deadline helpers ──
function fmtDeadline(iso) {
  if (!iso) return '';
  const [datePart, timePart] = iso.split(' ');
  const [, m, d] = datePart.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = months[parseInt(m, 10) - 1] + ' ' + parseInt(d, 10);
  return (timePart && timePart !== '00:00') ? dateStr + ' ' + timePart : dateStr;
}
function isOverdue(iso) {
  if (!iso) return false;
  const hasTime = iso.includes(' ');
  const d = hasTime ? new Date(iso.replace(' ', 'T')) : new Date(iso);
  const now = hasTime ? new Date() : new Date(new Date().toDateString());
  return d < now;
}

// ── Build todos HTML for a card ──
function buildTodosHTML(todos) {
  if (!todos || !todos.length) return '';
  const done  = todos.filter(t => t.done).length;
  const total = todos.length;
  const pct   = total ? Math.round(done / total * 100) : 0;
  const items = todos.map((t, i) =>
    `<label class='task__todo-item'>
       <input type='checkbox' class='task__todo-cb' data-idx='${i}' ${t.done ? 'checked' : ''}>
       <span class='task__todo-text${t.done ? ' task__todo-text--done' : ''}'>${t.text}</span>
     </label>`
  ).join('');
  return `<div class='task__todos'>
    ${items}
    <div class='task__todos-progress'>
      <span>${done}/${total}</span>
      <div class='task__todos-bar'><div class='task__todos-bar-fill' style='width:${pct}%'></div></div>
    </div>
  </div>`;
}

// ── Serialize a single card DOM element to plain JSON ──
function serializeTask(cardEl) {
  const tagClass = [...cardEl.querySelector('.task__tag').classList].find(c => c.startsWith('task__tag--'));
  const tag      = tagClass ? tagClass.replace('task__tag--', '') : 'copyright';
  const text     = cardEl.querySelector('p')?.textContent || '';
  const timeEl   = cardEl.querySelector('.task__stats time');
  const flagDate = timeEl
    ? [...timeEl.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
    : '';
  const statsSpans  = cardEl.querySelectorAll('.task__stats span');
  const comments    = parseInt(statsSpans[1]?.textContent) || 0;
  const attachments = parseInt(statsSpans[2]?.textContent) || 0;
  const todos = [...cardEl.querySelectorAll('.task__todo-item')].map(el => ({
    text: el.querySelector('.task__todo-text')?.textContent || '',
    done: el.querySelector('.task__todo-cb')?.checked || false
  }));
  const link = cardEl.querySelector('.task__link a')?.getAttribute('href') || '';
  const timeline    = [];
  cardEl.querySelectorAll('.task__tl-entry').forEach(entry => {
    const dotEl  = entry.querySelector('.task__tl-dot');
    const dotCls = [...dotEl.classList].find(c => c.startsWith('task__tl-dot--'));
    const type   = dotCls ? dotCls.replace('task__tl-dot--', '') : 'create';
    const textDiv = entry.querySelector('.task__tl-text');
    const author  = textDiv.querySelector('b')?.textContent || '';
    let entryText, date;
    if (type === 'comment') {
      entryText = textDiv.dataset.comment || '';
      date      = textDiv.querySelector('.task__tl-meta time')?.textContent || '';
    } else {
      date      = textDiv.querySelector('time')?.textContent || '';
      entryText = [...textDiv.childNodes]
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .filter(Boolean).join(' ');
    }
    const authorPhoto = textDiv.dataset.authorPhoto || '';
    timeline.push({ type, author, authorPhoto, text: entryText, date });
  });
  return {
    id:          cardEl.dataset.id || ('task-' + Date.now()),
    tag, text, flagDate, comments, attachments, todos, link,
    deadline:  cardEl.dataset.deadline || '',
    assignee:  cardEl.dataset.assignee || '',
    created:     cardEl.dataset.created || '',
    createdBy: {
      uid:         cardEl.dataset.createdByUid   || '',
      displayName: cardEl.dataset.createdByName  || '',
      photoURL:    cardEl.dataset.createdByPhoto || ''
    },
    timeline
  };
}

// ── Render a single card from JSON data ──
function renderCard(taskData) {
  const card       = document.createElement('div');
  card.className   = 'task';
  card.draggable   = true;
  card.dataset.id  = taskData.id;
  if (taskData.created) card.dataset.created = taskData.created;
  if (taskData.deadline) card.dataset.deadline = taskData.deadline;
  if (taskData.assignee) card.dataset.assignee = taskData.assignee;
  const cb = taskData.createdBy || {};
  card.dataset.createdByUid   = cb.uid         || '';
  card.dataset.createdByName  = cb.displayName || '';
  card.dataset.createdByPhoto = cb.photoURL    || '';
  const ownerName  = cb.displayName || '';
  const ownerPhoto = cb.photoURL    || '';
  const ownerHTML  = ownerName
    ? (ownerPhoto
        ? `<img class='tl-avatar' src='${ownerPhoto}' alt='${ownerName}' title='${ownerName}'>`
        : `<span class='tl-avatar tl-avatar--initial' title='${ownerName}'>${ownerName[0].toUpperCase()}</span>`)
    : '';
  const todosHTML = buildTodosHTML(taskData.todos);
  const linkHTML  = taskData.link
    ? `<div class='task__link'><a href='${taskData.link}' target='_blank' rel='noopener'><i class='fas fa-link'></i>${shortLinkLabel(taskData.link)}</a></div>`
    : '';
  const hasDeadline = !!taskData.deadline;
  const hasAssignee  = !!taskData.assignee;
  const flagSpanHTML = hasDeadline
    ? `<span class='task__deadline${isOverdue(taskData.deadline) ? ' task__deadline--overdue' : ''}'><i class='fas fa-calendar-alt'></i>${fmtDeadline(taskData.deadline)}</span>`
    : (hasAssignee ? `<span class='task__no-value'><i class='fas fa-calendar-alt'></i>No Deadline</span>` : '');
  const assigneeTagsHTML = hasAssignee
    ? `<span class='task__assignees'>${taskData.assignee.split(', ').map(n => resolveAssigneeAvatar(n.trim())).join('')}</span>`
    : (hasDeadline ? `<span class='task__no-value task__no-assignee'><i class='fas fa-user'></i>No Assignee</span>` : '');
  const statsHTML = (flagSpanHTML || assigneeTagsHTML)
    ? `<div class='task__stats'>${flagSpanHTML}${assigneeTagsHTML}</div>`
    : '';
  card.innerHTML   = `
    <div class='task__tags'>
      <span class='task__tag task__tag--${taskData.tag}'>${tagLabels[taskData.tag]}</span>
      <button class='task__options'><i class='fas fa-ellipsis-h'></i></button>
    </div>
    <p>${taskData.text}</p>
    ${todosHTML}
    ${linkHTML}
    ${statsHTML}`;
  {
    const creates = (taskData.timeline || []).filter(e => e.type === 'create');
    const others  = (taskData.timeline || []).filter(e => e.type !== 'create');
    // Synthesise a create entry from createdBy metadata when none is stored
    const createEntries = creates.length ? creates : (() => {
      const name  = cb.displayName || cb.uid;
      if (!name) return [];
      const date  = taskData.created
        ? new Date(taskData.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      return [{ type: 'create', author: name, authorPhoto: cb.photoURL || '', text: 'Card Created', date }];
    })();
    // create entries go FIRST → never :last-of-type → hidden when collapsed
    const ordered = [...createEntries, ...others];
    if (ordered.length) card.insertAdjacentHTML('beforeend', buildTimeline(ordered, { createOnly: !others.length }));
  }
  addUpdateWidget(card);
  refreshExpandBtn(card);
  return card;
}

// ── Append the update widget (age badge, dropdown, footer, comment box) ──
function addUpdateWidget(card) {
  const ageTxt = daysAgo(card.dataset.created);
  if (ageTxt) {
    card.querySelector('.task__options').insertAdjacentHTML('beforebegin',
      `<span class='task__age'>${ageTxt}</span>`);
  }
  card.querySelector('.task__tags').insertAdjacentHTML('beforeend',
    `<div class='task__dropdown'>
       <button class='task__opt-edit'><i class='fas fa-pen'></i> Edit</button>
       <button class='task__opt-delete danger'><i class='fas fa-trash-alt'></i> Delete</button>
     </div>`);
  card.insertAdjacentHTML('beforeend',
    `<div class='task__footer'>
       <button class='task__expand-btn'><i class='fas fa-chevron-down'></i><span></span></button>
     </div>
     <div class='task__comment-box'>
       <textarea class='task__comment-input' placeholder='Add a comment...' rows='2'></textarea>
       <div class='task__comment-actions'>
         <button class='task__cc-cancel'>Cancel</button>
         <button class='task__cc-submit'>Post</button>
       </div>
     </div>`);
  card.querySelector('.task__comment-input').addEventListener('mousedown', e => e.stopPropagation());
}

// ── Refresh the expand/collapse button state ──
function refreshExpandBtn(card) {
  const btn     = card.querySelector('.task__expand-btn');
  if (!btn) return;
  const entries = card.querySelectorAll('.task__tl-entry');
  const count   = entries.length;
  if (count <= 1) { btn.classList.remove('has-history'); return; }
  btn.classList.add('has-history');
  const expanded = card.classList.contains('task--expanded');
  btn.querySelector('span').textContent = expanded ? ' collapse' : ` ${count - 1} earlier`;
  btn.querySelector('.fas').className   = expanded ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
}
