/* global Office */
'use strict';

const FUNCTION_BASE = 'https://us-central1-threedots-92cd6.cloudfunctions.net';

Office.onReady(() => {
  const token = sessionStorage.getItem('qnotes_token');
  if (token) {
    showMain(token);
  } else {
    document.getElementById('login-view').style.display = 'block';
  }

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('boardSelect').addEventListener('change', loadColumns);
  document.getElementById('sendBtn').addEventListener('click', createCard);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

async function doLogin() {
  const btn      = document.getElementById('loginBtn');
  const errorEl  = document.getElementById('login-error');
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Please enter your email and password.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res  = await apiFetch('/addinLogin', 'POST', { email, password }, null);
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Login failed. Check your credentials.';
      return;
    }
    sessionStorage.setItem('qnotes_token', data.token);
    showMain(data.token);
  } catch {
    errorEl.textContent = 'Network error. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

function doLogout() {
  sessionStorage.removeItem('qnotes_token');
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('login-view').style.display = 'block';
  document.getElementById('status').textContent = '';
}

// ── Main view ────────────────────────────────────────────────────────────────

async function showMain(token) {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('main-view').style.display  = 'block';

  // Show email metadata
  const item = Office.context.mailbox.item;
  document.getElementById('preview-subject').textContent = item.subject || '(no subject)';
  if (item.from && item.from.getAsync) {
    item.from.getAsync(r => {
      const addr = r.value?.emailAddress || '';
      const name = r.value?.displayName  || '';
      document.getElementById('preview-from').textContent = name ? `${name} <${addr}>` : addr;
    });
  }

  // Load boards
  try {
    const res    = await apiFetch('/addinGetBoards', 'GET', null, token);
    const boards = await res.json();
    const sel    = document.getElementById('boardSelect');
    sel.innerHTML = boards.length
      ? boards.map(b => `<option value="${escAttr(b.id)}">${escText(b.name)}</option>`).join('')
      : '<option value="">No boards found</option>';
    if (boards.length) loadColumns();
  } catch {
    setStatus('Failed to load boards.', true);
  }
}

async function loadColumns() {
  const token   = sessionStorage.getItem('qnotes_token');
  const boardId = document.getElementById('boardSelect').value;
  if (!boardId) return;

  try {
    const res  = await apiFetch(`/addinGetColumns?boardId=${encodeURIComponent(boardId)}`, 'GET', null, token);
    const cols = await res.json();
    document.getElementById('columnSelect').innerHTML = cols.length
      ? cols.map(c => `<option value="${escAttr(String(c.id))}">${escText(c.name)}</option>`).join('')
      : '<option value="0">Default</option>';
  } catch {
    document.getElementById('columnSelect').innerHTML = '<option value="0">Default</option>';
  }
}

async function createCard() {
  const token    = sessionStorage.getItem('qnotes_token');
  const boardId  = document.getElementById('boardSelect').value;
  const columnId = document.getElementById('columnSelect').value;
  const btn      = document.getElementById('sendBtn');

  if (!boardId) { setStatus('Please select a board.', true); return; }

  btn.disabled    = true;
  btn.textContent = 'Creating…';
  setStatus('');

  const item = Office.context.mailbox.item;
  item.body.getAsync(Office.CoercionType.Text, async r => {
    const body  = r.value?.trim() || '';
    const title = item.subject || '(no subject)';

    try {
      const res = await apiFetch('/addinCreateCard', 'POST', { boardId, columnId, title, text: body }, token);
      if (res.ok) {
        setStatus('Card created successfully!', false);
      } else {
        const data = await res.json().catch(() => ({}));
        setStatus(data.error || 'Failed to create card.', true);
      }
    } catch {
      setStatus('Network error. Please try again.', true);
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Create Card';
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiFetch(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(FUNCTION_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
}

function setStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className   = isError ? 'status fail' : 'status';
}

function escAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escText(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
