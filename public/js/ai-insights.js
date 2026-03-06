// ── Board Insights Dashboard (data-driven, no AI) ─────────────────────────
(function () {
  let isOpen = false;

  // ── Collect all cards from the live DOM ─────────────────────────────────
  function collectBoardData() {
    const columns = [];
    document.querySelectorAll('.project-column:not(.project-column--archive)').forEach(col => {
      const name  = col.querySelector('.project-column-heading__title')?.textContent?.trim() || 'Untitled';
      const cards = [];
      col.querySelectorAll('.task').forEach(cardEl => {
        const tagClass = [...cardEl.querySelector('.task__tag').classList]
          .find(c => c.startsWith('task__tag--'));
        const tagLabel = cardEl.querySelector('.task__tag')?.textContent?.trim() || '';
        const title    = (cardEl.querySelector('.task__title')?.textContent || cardEl.dataset.title || '').trim();
        const deadline = cardEl.dataset.deadline || '';
        const assignee = (cardEl.dataset.assignee || '').trim();
        const created  = cardEl.dataset.created  || '';
        const todoCbs  = [...cardEl.querySelectorAll('.task__todo-cb')];
        const todoDone  = todoCbs.filter(c => c.checked).length;
        const todoTotal = todoCbs.length;
        const commentEls = [...cardEl.querySelectorAll('.task__tl-entry')].filter(e =>
          [...(e.querySelector('.task__tl-dot')?.classList || [])].includes('task__tl-dot--comment')
        );
        const overdue = deadline ? isOverdue(deadline) : false; // isOverdue from cards.js
        cards.push({
          tagLabel, title, deadline, assignee, created,
          todoDone, todoTotal, comments: commentEls.length, overdue,
          colName: name
        });
      });
      columns.push({ name, cards });
    });
    return columns;
  }

  // ── Derive all metrics ───────────────────────────────────────────────────
  function deriveInsights(columns) {
    const allCards = columns.flatMap(c => c.cards);
    const total    = allCards.length;
    if (!total) return null;

    const overdueCards = allCards.filter(c => c.overdue);
    const unassigned   = allCards.filter(c => !c.assignee);
    const noDeadline   = allCards.filter(c => !c.deadline);
    const noTitle      = allCards.filter(c => !c.title);

    const totalTodoDone  = allCards.reduce((s, c) => s + c.todoDone, 0);
    const totalTodoItems = allCards.reduce((s, c) => s + c.todoTotal, 0);
    const todoCompletionPct = totalTodoItems > 0 ? Math.round(totalTodoDone / totalTodoItems * 100) : null;

    const tagCounts = {};
    allCards.forEach(c => { tagCounts[c.tagLabel] = (tagCounts[c.tagLabel] || 0) + 1; });
    const tagsSorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

    const assigneeCounts = {};
    allCards.forEach(c => {
      if (!c.assignee) return;
      c.assignee.split(',').map(a => a.trim()).filter(Boolean)
        .forEach(a => { assigneeCounts[a] = (assigneeCounts[a] || 0) + 1; });
    });
    const assigneesSorted = Object.entries(assigneeCounts).sort((a, b) => b[1] - a[1]);

    const colsSorted = [...columns].sort((a, b) => b.cards.length - a.cards.length);

    const now = Date.now();
    const recentCards = allCards.filter(c =>
      c.created && (now - new Date(c.created).getTime()) < 7 * 24 * 60 * 60 * 1000
    );

    // Health score 0–100
    let score = 100;
    score -= Math.round((overdueCards.length / total) * 30);
    score -= Math.round((unassigned.length   / total) * 20);
    score -= Math.round((noDeadline.length   / total) * 15);
    if (todoCompletionPct !== null) score += Math.round((todoCompletionPct / 100) * 10) - 5;
    score = Math.max(0, Math.min(100, score));

    return {
      total, columns, allCards, colsSorted,
      overdueCards, unassigned, noDeadline, noTitle,
      totalTodoDone, totalTodoItems, todoCompletionPct,
      tagsSorted, assigneesSorted, recentCards, score
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function pctBar(pct, colorClass) {
    return `<div class="ins-bar"><div class="ins-bar__fill ins-bar__fill--${colorClass}" style="width:${Math.max(2,pct)}%"></div></div>`;
  }

  function scoreColor(s) { return s >= 75 ? 'green' : s >= 45 ? 'amber' : 'red'; }
  function scoreLabel(s) { return s >= 75 ? 'Healthy' : s >= 45 ? 'Needs Attention' : 'At Risk'; }

  // ── Render full dashboard ─────────────────────────────────────────────────
  function renderDashboard(ins) {
    const { total, columns, colsSorted, overdueCards, unassigned, noDeadline, noTitle,
            totalTodoDone, totalTodoItems, todoCompletionPct,
            tagsSorted, assigneesSorted, recentCards, score } = ins;

    const sc           = scoreColor(score);
    const maxColCards  = colsSorted[0]?.cards.length || 1;
    const maxAssignee  = assigneesSorted[0]?.[1] || 1;
    const maxTag       = tagsSorted[0]?.[1] || 1;

    // KPIs
    const kpiHtml = `
      <div class="ins-kpis">
        <div class="ins-kpi">
          <span class="ins-kpi__value">${total}</span>
          <span class="ins-kpi__label">Total Cards</span>
        </div>
        <div class="ins-kpi ins-kpi--${overdueCards.length ? 'red' : 'muted'}">
          <span class="ins-kpi__value">${overdueCards.length}</span>
          <span class="ins-kpi__label">Overdue</span>
        </div>
        <div class="ins-kpi ins-kpi--${unassigned.length ? 'amber' : 'muted'}">
          <span class="ins-kpi__value">${unassigned.length}</span>
          <span class="ins-kpi__label">Unassigned</span>
        </div>
        <div class="ins-kpi ins-kpi--${recentCards.length ? 'blue' : 'muted'}">
          <span class="ins-kpi__value">${recentCards.length}</span>
          <span class="ins-kpi__label">New (7d)</span>
        </div>
      </div>`;

    // Health score ring
    const healthHtml = `
      <div class="ins-section">
        <div class="ins-health">
          <div class="ins-health__ring ins-health__ring--${sc}">
            <span class="ins-health__score">${score}</span>
          </div>
          <div class="ins-health__info">
            <div class="ins-health__label ins-health__label--${sc}">${scoreLabel(score)}</div>
            <div class="ins-health__sub">Board health score</div>
          </div>
        </div>
      </div>`;

    // Summary bullet list
    const bullets = [];
    if (overdueCards.length)  bullets.push(`<li>${overdueCards.length} card${overdueCards.length > 1 ? 's are' : ' is'} past deadline.</li>`);
    if (unassigned.length)    bullets.push(`<li>${unassigned.length} card${unassigned.length > 1 ? 's have' : ' has'} no assignee.</li>`);
    if (noDeadline.length)    bullets.push(`<li>${noDeadline.length} card${noDeadline.length > 1 ? 's are' : ' is'} missing a deadline.</li>`);
    if (noTitle.length)       bullets.push(`<li>${noTitle.length} card${noTitle.length > 1 ? 's have' : ' has'} no title.</li>`);
    const bottleneck = colsSorted.find(c => c.cards.length / total > 0.4 && columns.length > 1);
    if (bottleneck)           bullets.push(`<li><strong>${esc(bottleneck.name)}</strong> holds ${Math.round(bottleneck.cards.length/total*100)}% of all work — consider redistributing.</li>`);
    if (recentCards.length)   bullets.push(`<li>${recentCards.length} card${recentCards.length > 1 ? 's were' : ' was'} added in the last 7 days.</li>`);
    const summaryHtml = bullets.length ? `
      <div class="ins-section">
        <div class="ins-section__title"><i class="fas fa-info-circle"></i> Summary</div>
        <ul class="ins-attention-list">${bullets.join('')}</ul>
      </div>` : '';

    // Column load bars
    const colRows = colsSorted.map(c => {
      const pct      = Math.round(c.cards.length / maxColCards * 100);
      const barColor = c.cards.length === maxColCards && maxColCards > 1 ? 'amber' : 'blue';
      return `<div class="ins-row">
        <span class="ins-row__label" title="${esc(c.name)}">${esc(c.name)}</span>
        <div class="ins-row__bar-wrap">${pctBar(pct, barColor)}<span class="ins-row__count">${c.cards.length}</span></div>
      </div>`;
    }).join('');
    const colHtml = `
      <div class="ins-section">
        <div class="ins-section__title"><i class="fas fa-columns"></i> Column Load</div>
        ${colRows || '<p class="ins-empty-note">No columns.</p>'}
      </div>`;

    // Tag breakdown
    const tagRows = tagsSorted.map(([label, count]) => {
      const tagEl = [...document.querySelectorAll('.task__tag')].find(el => el.textContent.trim() === label);
      const bg    = tagEl ? getComputedStyle(tagEl).backgroundColor : '#94a3b8';
      const pct   = Math.round(count / maxTag * 100);
      return `<div class="ins-row">
        <span class="ins-row__label"><span class="ins-dot" style="background:${bg}"></span>${esc(label)}</span>
        <div class="ins-row__bar-wrap">${pctBar(pct, 'tag')}<span class="ins-row__count">${count}</span></div>
      </div>`;
    }).join('');
    const tagsHtml = `
      <div class="ins-section">
        <div class="ins-section__title"><i class="fas fa-tag"></i> Tag Breakdown</div>
        ${tagRows || '<p class="ins-empty-note">No tags.</p>'}
      </div>`;

    // Assignee workload
    let assigneeHtml = '';
    if (assigneesSorted.length) {
      const rows = assigneesSorted.map(([name, count]) => {
        const pct = Math.round(count / maxAssignee * 100);
        return `<div class="ins-row">
          <span class="ins-row__label"><span class="ins-avatar">${esc(name[0]?.toUpperCase()||'?')}</span>${esc(name)}</span>
          <div class="ins-row__bar-wrap">${pctBar(pct, 'purple')}<span class="ins-row__count">${count}</span></div>
        </div>`;
      }).join('');
      assigneeHtml = `
        <div class="ins-section">
          <div class="ins-section__title"><i class="fas fa-user"></i> Assignee Workload</div>
          ${rows}
        </div>`;
    }

    // Todo progress
    let todoHtml = '';
    if (totalTodoItems > 0) {
      const pct      = todoCompletionPct;
      const barColor = pct >= 75 ? 'green' : pct >= 40 ? 'amber' : 'red';
      todoHtml = `
        <div class="ins-section">
          <div class="ins-section__title"><i class="fas fa-check-square"></i> To-Do Progress</div>
          <div class="ins-todo-summary">
            ${pctBar(pct, barColor)}
            <span class="ins-todo-summary__label">${totalTodoDone} / ${totalTodoItems} done (${pct}%)</span>
          </div>
        </div>`;
    }

    // Overdue list
    let overdueHtml = '';
    if (overdueCards.length) {
      const items = overdueCards.slice(0, 8).map(c => `
        <div class="ins-card-row">
          <i class="fas fa-exclamation-circle ins-card-row__icon ins-card-row__icon--red"></i>
          <div class="ins-card-row__text">
            <span class="ins-card-row__title">${esc(c.title || '(no title)')}</span>
            <span class="ins-card-row__meta">${esc(c.colName)} &middot; Due ${esc(c.deadline)}</span>
          </div>
        </div>`).join('');
      const more = overdueCards.length > 8 ? `<p class="ins-more">+${overdueCards.length - 8} more</p>` : '';
      overdueHtml = `
        <div class="ins-section">
          <div class="ins-section__title ins-section__title--red"><i class="fas fa-clock"></i> Overdue Cards</div>
          ${items}${more}
        </div>`;
    }

    return `<div class="ins-dashboard">
      ${kpiHtml}${healthHtml}${summaryHtml}${colHtml}${tagsHtml}${assigneeHtml}${todoHtml}${overdueHtml}
    </div>`;
  }

  // ── Panel open / close ────────────────────────────────────────────────────
  function openPanel() {
    document.getElementById('insightsPanel').classList.add('open');
    document.getElementById('insightsBtn').classList.add('active');
    isOpen = true;
  }

  function closePanel() {
    document.getElementById('insightsPanel').classList.remove('open');
    document.getElementById('insightsBtn').classList.remove('active');
    isOpen = false;
  }

  // ── Build and inject dashboard ────────────────────────────────────────────
  function runInsights() {
    const body    = document.getElementById('insightsPanelBody');
    const ins     = deriveInsights(collectBoardData());
    if (!ins) {
      body.innerHTML = `<div class="insights-empty"><i class="fas fa-inbox"></i><p>No cards found on the board.</p></div>`;
      return;
    }
    body.innerHTML = renderDashboard(ins);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const btn        = document.getElementById('insightsBtn');
    const closeBtn   = document.getElementById('insightsPanelClose');
    const refreshBtn = document.getElementById('insightsPanelRefresh');
    if (!btn) return;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (isOpen) { closePanel(); return; }
      openPanel();
      runInsights();
    });

    closeBtn?.addEventListener('click', () => closePanel());

    refreshBtn?.addEventListener('click', () => runInsights());

    // Close on outside click
    document.addEventListener('click', e => {
      if (!isOpen) return;
      const panel = document.getElementById('insightsPanel');
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePanel();
    });
  });
}());

