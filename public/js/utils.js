// ── Shared tag labels ──
const tagLabels = {
  urgent:       'Urgent',
  review:       'Review',
  research:     'Research',
  docs:         'Docs',
  qa:           'QA',
  backend:      'Backend',
  design:       'UI Design',
  feature:      'Feature',
  illustration: 'Illustration',
  copyright:    'Copywriting'
};

// ── Save toast ──
let _toastTimer;
function showToast(msg, isError) {
  const t = document.getElementById('saveToast');
  if (!t) return;
  t.textContent = msg;
  t.style.background = isError ? '#e05252' : 'var(--purple)';
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ── Activity feed ──
const MAX_ACTIVITY = 20;
function logActivity(type, text, timeLabel) {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;
  const icons = {
    comment: { cls: 'task-icon--comment',    icon: 'fas fa-comment'     },
    edit:    { cls: 'task-icon--edit',       icon: 'fas fa-pencil-alt'  },
    create:  { cls: 'task-icon--edit',       icon: 'fas fa-plus'        },
    delete:  { cls: 'task-icon--delete',     icon: 'fas fa-trash-alt'   },
    move:    { cls: 'task-icon--move',       icon: 'fas fa-arrows-alt'  },
    attach:  { cls: 'task-icon--attachment', icon: 'fas fa-paperclip'   },
  };
  const { cls, icon } = icons[type] || icons.edit;
  const now = timeLabel || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const li  = document.createElement('li');
  li.innerHTML = `<span class='task-icon ${cls}'><i class='${icon}'></i></span>${text}<time>${now}</time>`;
  feed.prepend(li);
  while (feed.children.length > MAX_ACTIVITY) feed.lastElementChild.remove();
}

// ── Days-since helper ──
function daysAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return '1d ago';
  return `${diff}d ago`;
}

// ── Timeline HTML builder ──
function buildTimeline(entries) {
  if (!entries || !entries.length) return '';
  return `<div class="task__timeline">
    ${entries.map(e => {
      const isComment   = e.type === 'comment';
      const authorPhoto = e.authorPhoto || '';
      const authorName  = e.author      || '?';
      const avatarHTML  = authorPhoto
        ? `<img class='tl-avatar' src='${authorPhoto}' alt='${authorName}' title='${authorName}'>`
        : `<span class='tl-avatar tl-avatar--initial' title='${authorName}'>${authorName[0].toUpperCase()}</span>`;
      const editBtn = isComment
        ? `<button class="task__tl-edit-btn" title="Edit comment"><i class="fas fa-pen"></i></button>`
        : '';
      const textDiv = isComment
        ? `<div class="task__tl-text" data-comment="${e.text.replace(/"/g, '&quot;')}" data-author-photo="${authorPhoto}"><b>${authorName}</b> ${e.text}<div class="task__tl-meta"><time>${e.date}</time>${editBtn}</div></div>`
        : `<div class="task__tl-text" data-author-photo="${authorPhoto}"><b>${authorName}</b> ${e.text}<time>${e.date}</time></div>`;
      return `<div class="task__tl-entry"><span class="task__tl-dot task__tl-dot--${e.type || 'create'}">${avatarHTML}</span>${textDiv}</div>`;
    }).join('')}
  </div>`;
}
