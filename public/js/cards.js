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
    timeline.push({ type, author, text: entryText, date });
  });
  return {
    id:          cardEl.dataset.id || ('task-' + Date.now()),
    tag, text, flagDate, comments, attachments,
    created:     cardEl.dataset.created || '',
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
  card.innerHTML   = `
    <div class='task__tags'>
      <span class='task__tag task__tag--${taskData.tag}'>${tagLabels[taskData.tag]}</span>
      <button class='task__options'><i class='fas fa-ellipsis-h'></i></button>
    </div>
    <p>${taskData.text}</p>
    <div class='task__stats'>
      <span><time><i class='fas fa-flag'></i>${taskData.flagDate}</time></span>
      <span><i class='fas fa-comment'></i>${taskData.comments}</span>
      <span><i class='fas fa-paperclip'></i>${taskData.attachments}</span>
      <span class='task__owner'></span>
    </div>`;
  if (taskData.timeline && taskData.timeline.length) {
    card.insertAdjacentHTML('beforeend', buildTimeline(taskData.timeline));
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
       <button class='task__update-btn'><i class='fas fa-pencil-alt'></i> Update</button>
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
