// ── HTML escaping (prevents stored XSS in innerHTML) ──
function escapeHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Shared tag labels (keys must match DEFAULT_TAGS ids in tags.js) ──
const tagLabels = {
  urgent:      'Urgent',
  onhold:      'On Hold',
  task:        'Task',
  maintenance: 'Maintenance',
  operation:   'Operation',
  support:     'Support',
  design:      'Design',
  feature:     'Feature',
  issue:       'Issue',
  report:      'Report'
};

// ── Save toast ──
let _toastTimer;
function showToast(msg, isError) {
  const t = document.getElementById('saveToast');
  if (!t) return;
  t.textContent = msg;
  t.style.background = isError ? '#e05252' : 'var(--purple)';
  t.classList.remove('toast--undo');
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 4000 : 2000);
}

// ── Undo toast — shows an action button for a limited time window ──
let _undoTimer;
function showUndoToast(msg, onUndo, duration = 6000) {
  const t = document.getElementById('saveToast');
  if (!t) return;
  clearTimeout(_toastTimer);
  clearTimeout(_undoTimer);
  t.classList.add('toast--undo');
  t.innerHTML = `<span class="toast__msg">${msg}</span><button class="toast__undo-btn" type="button">Undo</button>`;
  t.style.background = 'var(--purple)';
  t.classList.add('show');
  const btn = t.querySelector('.toast__undo-btn');
  const dismiss = () => {
    t.classList.remove('show');
    t.classList.remove('toast--undo');
  };
  btn.addEventListener('click', () => {
    clearTimeout(_undoTimer);
    dismiss();
    if (typeof onUndo === 'function') onUndo();
  });
  _undoTimer = setTimeout(dismiss, duration);
}

// ── Activity feed ──
const MAX_ACTIVITY = 200;

// Sanitize activity text: allow only safe inline tags with no event-handler attributes.
function _sanitizeActivityText(html) {
  const allowed = new Set(['b', 'em', 'i', 's', 'br', 'span']);
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('*').forEach(el => {
    if (!allowed.has(el.tagName.toLowerCase())) {
      el.replaceWith(document.createTextNode(el.textContent));
    } else {
      // Keep only the 'class' attribute; strip everything else (incl. onerror, onclick)
      [...el.attributes].forEach(a => { if (a.name !== 'class') el.removeAttribute(a.name); });
    }
  });
  return div.innerHTML;
}

function logActivity(type, text, timeLabel, ts, skipPersist) {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;
  const icons = {
    comment:     { cls: 'task-icon--comment',     icon: 'fas fa-comment'     },
    edit:        { cls: 'task-icon--edit',         icon: 'fas fa-pencil-alt'  },
    create:      { cls: 'task-icon--edit',         icon: 'fas fa-plus'        },
    delete:      { cls: 'task-icon--delete',       icon: 'fas fa-trash-alt'   },
    move:        { cls: 'task-icon--move',         icon: 'fas fa-arrows-alt'  },
    attach:      { cls: 'task-icon--attachment',   icon: 'fas fa-paperclip'   },
    todo:        { cls: 'task-icon--todo',         icon: 'fas fa-check-square'},
    participant: { cls: 'task-icon--participant',  icon: 'fas fa-user-plus'   },
  };
  const { cls, icon } = icons[type] || icons.edit;
  const finalTs = ts || Date.now();
  const now = timeLabel || new Date(finalTs).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const li  = document.createElement('li');
  li.dataset.ts = finalTs;
  li.innerHTML = `<span class='task-icon ${cls}'><i class='${icon}'></i></span>${_sanitizeActivityText(text)}<time>${escapeHTML(now)}</time>`;
  feed.prepend(li);
  while (feed.children.length > MAX_ACTIVITY) feed.lastElementChild.remove();
  if (window._filterActivityFeed) window._filterActivityFeed();
  if (!skipPersist && window._persistActivity) window._persistActivity(type, text, now, finalTs);
}

// ── Days-since helper ──
function daysAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return '1d ago';
  return `${diff}d ago`;
}

// ── Strip year from stored date strings e.g. "Mar 4, 2026, 9:27 AM" → "Mar 4, 9:27 AM" ──
function stripYear(str) {
  return str ? str.replace(/,\s*\d{4}(?=,)/, '') : str;
}

// ── Format a timestamp to "Mar 4, 9:27 AM" ──
function fmtDate(ts) {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Extract first name from a full name string ──
function firstNameOnly(name) {
  if (!name) return name;
  return name.split(' ')[0];
}

// ── Build comment tl-meta HTML snippet ──
function tlMetaHTML(comment, time, author) {
  return `${escapeHTML(comment)}<div class='task__tl-meta'><time>${escapeHTML(time)}</time><b>${escapeHTML(author)}</b></div>`;
}

// ── Timeline HTML builder ──
function buildTimeline(entries, opts) {
  if (!entries || !entries.length) return '';
  const createOnly = opts && opts.createOnly;
  return `<div class="task__timeline${createOnly ? ' task__timeline--create-only' : ''}">
    ${entries.map(e => {
      const isComment   = e.type === 'comment';
      // Resolve UID → display name/photo; fall back gracefully for legacy display-name entries
      const _resolved   = (window._uidMap && e.author) ? window._uidMap[e.author] : null;
      const authorName  = firstNameOnly(_resolved ? _resolved.name  : (e.author || 'User'));
      const authorPhoto = _resolved ? _resolved.photo : (window._userPhotoMap && e.author ? (window._userPhotoMap[e.author] || '') : '');
      const initial     = authorName && authorName[0] ? authorName[0].toUpperCase() : '?';
      const _safeAuthor = String(authorName).replace(/\\/g, '\\\\').replace(/[\r\n]/g, ' ').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const avatarFallback = `this.replaceWith(Object.assign(document.createElement('span'),{className:'tl-avatar tl-avatar--initial',title:'${_safeAuthor}',textContent:'${initial}'}))`;
      const avatarHTML  = authorPhoto
        ? `<img class='tl-avatar' src='${authorPhoto}' alt='${escapeHTML(authorName)}' title='${escapeHTML(authorName)}' onerror="${avatarFallback}">`
        : `<span class='tl-avatar tl-avatar--initial' title='${escapeHTML(authorName)}'>${initial}</span>`;
      const displayDate = stripYear(e.date);
      const _cleanTimelineText = String(e.text || '').replace(/<[^>]*>/g, '');
      const textDiv = isComment
        ? `<div class="task__tl-text" data-comment="${escapeHTML(e.text)}">${escapeHTML(e.text)}<div class="task__tl-meta"><time>${displayDate}</time><b>${escapeHTML(authorName)}</b></div></div>`
        : (e.type === 'create' || e.type === 'delete')
          ? `<div class="task__tl-text">${escapeHTML(_cleanTimelineText)}<div class="task__tl-meta"><time>${displayDate}</time><b>${escapeHTML(authorName)}</b></div></div>`
          : `<div class="task__tl-text"><b>${escapeHTML(authorName)}</b> ${escapeHTML(e.text)}<time>${displayDate}</time></div>`;
      const createClass = (e.type === 'create') ? ' task__tl-entry--create' : '';
      return `<div class="task__tl-entry${createClass}" data-ts="${e.ts || ''}" data-author-uid="${e.author || ''}"><span class="task__tl-dot task__tl-dot--${e.type || 'create'}">${avatarHTML}</span>${textDiv}</div>`;
    }).join('')}
  </div>`;
}
// ── Per-user photo cache (name → photoURL) ──
window._userPhotoMap = window._userPhotoMap || {};
// ── Per-user UID cache (uid → { name, photo }) ──
window._uidMap = window._uidMap || {};

// ── Resolve an assignee name → avatar HTML (img or initial circle) with tooltip ──
function resolveAssigneeAvatar(name) {
  const initial = name && name[0] ? name[0].toUpperCase() : '?';
  const _safeJsName = String(name).replace(/\\/g, '\\\\').replace(/[\r\n]/g, ' ').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const fallback = `this.replaceWith(Object.assign(document.createElement('span'),{className:'tl-avatar tl-avatar--initial tl-avatar--assignee',title:'${_safeJsName}',textContent:'${initial}'}))`;
  const imgTag = (src) => `<img class='tl-avatar tl-avatar--assignee' src='${src}' alt='${escapeHTML(name)}' title='${escapeHTML(name)}' onerror="${fallback}">`;
  // 1. Fast path: pre-built photo map
  const mapped = window._userPhotoMap[name];
  if (mapped) return imgTag(mapped);
  // 2. Logged-in nav user
  const navName = document.getElementById('navUserName')?.textContent?.trim();
  if (navName && navName === name) {
    const navImg = document.querySelector('#navAvatar img');
    if (navImg) return imgTag(navImg.src);
    return `<span class='tl-avatar tl-avatar--initial tl-avatar--assignee' title='${escapeHTML(name)}'>${initial}</span>`;
  }
  // 3. Participants DOM fallback — result cached in _userPhotoMap to avoid repeat traversals
  let photo = '';
  document.querySelectorAll('#projectParticipants .participant-avatar').forEach(av => {
    const n = av.querySelector('.pcard__name')?.textContent?.trim();
    if (n === name) {
      const img = av.querySelector('img');
      if (img) photo = img.src;
    }
  });
  if (photo) { window._userPhotoMap[name] = photo; return imgTag(photo); }
  return `<span class='tl-avatar tl-avatar--initial tl-avatar--assignee' title='${escapeHTML(name)}'>${initial}</span>`;
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