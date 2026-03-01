// ── Shared tag labels ──
const tagLabels = {
  urgent:      'Urgent',
  onhold:      'On Hold',
  task:        'Task',
  maintenance: 'Maintenance',
  operations:  'Operations',
  support:     'Support',
  design:      'Design',
  feature:     'Feature',
  issues:      'Issues',
  report:      'Report'
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
function buildTimeline(entries, opts) {
  if (!entries || !entries.length) return '';
  const createOnly = opts && opts.createOnly;
  return `<div class="task__timeline${createOnly ? ' task__timeline--create-only' : ''}">
    ${entries.map(e => {
      const isComment   = e.type === 'comment';
      const authorPhoto = e.authorPhoto || '';
      const authorName  = e.author      || '?';
      const avatarHTML  = authorPhoto
        ? `<img class='tl-avatar' src='${authorPhoto}' alt='${authorName}' title='${authorName}'>`
        : `<span class='tl-avatar tl-avatar--initial' title='${authorName}'>${authorName[0].toUpperCase()}</span>`;
      const editBtn = '';
      const textDiv = isComment
        ? `<div class="task__tl-text" data-comment="${e.text.replace(/"/g, '&quot;')}" data-author-photo="${authorPhoto}">${e.text}<div class="task__tl-meta"><time>${e.date}</time><b>${authorName}</b></div></div>`
        : e.type === 'create'
          ? `<div class="task__tl-text" data-author-photo="${authorPhoto}">${e.text}<time>${e.date}</time></div>`
          : `<div class="task__tl-text" data-author-photo="${authorPhoto}"><b>${authorName}</b> ${e.text}<time>${e.date}</time></div>`;
      const createClass = (e.type === 'create') ? ' task__tl-entry--create' : '';
      return `<div class="task__tl-entry${createClass}"><span class="task__tl-dot task__tl-dot--${e.type || 'create'}">${avatarHTML}</span>${textDiv}</div>`;
    }).join('')}
  </div>`;
}
// ── Per-user photo cache (name → photoURL) ──
window._userPhotoMap = window._userPhotoMap || {};

// ── Resolve an assignee name → avatar HTML (img or initial circle) with tooltip ──
function resolveAssigneeAvatar(name) {
  // 1. Fast path: pre-built photo map
  const mapped = window._userPhotoMap[name];
  if (mapped) {
    return `<img class='tl-avatar tl-avatar--assignee' src='${mapped}' alt='${name}' title='${name}'>`;
  }
  // 2. Logged-in nav user
  const navName = document.getElementById('navUserName')?.textContent?.trim();
  if (navName && navName === name) {
    const navImg = document.querySelector('#navAvatar img');
    if (navImg) {
      return `<img class='tl-avatar tl-avatar--assignee' src='${navImg.src}' alt='${name}' title='${name}'>`;
    }
    return `<span class='tl-avatar tl-avatar--initial tl-avatar--assignee' title='${name}'>${name[0].toUpperCase()}</span>`;
  }
  // 3. Participants DOM fallback
  let photo = '';
  document.querySelectorAll('#projectParticipants .participant-avatar').forEach(av => {
    const n = av.querySelector('.pcard__name')?.textContent?.trim();
    if (n === name) {
      const img = av.querySelector('img');
      if (img) photo = img.src;
    }
  });
  if (photo) {
    return `<img class='tl-avatar tl-avatar--assignee' src='${photo}' alt='${name}' title='${name}'>`;
  }
  return `<span class='tl-avatar tl-avatar--initial tl-avatar--assignee' title='${name}'>${name[0].toUpperCase()}</span>`;
}

// ── Refresh all card assignee avatars after photo map is updated ──
function refreshAllAssigneeAvatars() {
  document.querySelectorAll('.task[data-assignee]').forEach(card => {
    const assignee = card.dataset.assignee;
    if (!assignee) return;
    const span = card.querySelector('.task__assignees');
    if (!span) return;
    span.innerHTML = assignee.split(', ').map(n => resolveAssigneeAvatar(n.trim())).join('');
  });
}