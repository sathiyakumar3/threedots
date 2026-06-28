// ── Floating column-name ghost bar ───────────────────────────────────────────
// Appears after scrolling past the column headings; disappears at the top.
(function () {
  const bar      = document.getElementById('colGhostBar');
  const labelsEl = document.getElementById('colGhostLabels');
  if (!bar || !labelsEl) return;

  const projectBody = document.querySelector('.project-body');

  // ── Cache the scroll threshold once the board has rendered ───────────────
  let _threshold = null;
  function getThreshold() {
    if (_threshold !== null) return _threshold;
    const heading = document.querySelector('.project-tasks > .project-column .project-column-heading');
    if (!heading) return 120;
    // offsetTop chain to get absolute document position
    let top = 0;
    let el  = heading;
    while (el) { top += el.offsetTop; el = el.offsetParent; }
    _threshold = Math.max(40, top + 60);
    return _threshold;
  }

  // ── Build / update label chips ────────────────────────────────────────────
  function buildLabels() {
    labelsEl.innerHTML = '';
    const cols = [...document.querySelectorAll(
      '.project-tasks > .project-column:not(.project-column--collapsed):not(.project-column--trash):not(.project-column--archive)'
    )];

    cols.forEach(col => {
      const rect = col.getBoundingClientRect();
      if (rect.right < 4 || rect.left > window.innerWidth - 4) return;

      const title = col.querySelector('.project-column-heading__title')?.textContent?.trim() || '';
      const chip  = document.createElement('div');
      chip.className   = 'col-ghost-label';
      chip.textContent = title;
      // Centre the pill horizontally within the column
      const centre = rect.left + rect.width / 2;
      chip.style.left      = centre + 'px';
      chip.style.transform = 'translateX(-50%)';
      chip.style.maxWidth  = Math.max(60, rect.width - 24) + 'px';
      labelsEl.appendChild(chip);
    });
  }

  // ── Main update: show/hide + reposition ──────────────────────────────────
  let _ticking = false;
  function update() {
    if (_ticking) return;
    _ticking = true;
    requestAnimationFrame(() => {
      _ticking = false;
      if (window.scrollY > getThreshold()) {
        buildLabels();
        bar.classList.add('col-ghost-bar--visible');
        // Trigger adaptive contrast so pills react to whatever is behind them
        window._updateIconContrast?.();
      } else {
        bar.classList.remove('col-ghost-bar--visible');
      }
    });
  }

  // Invalidate cache when the board re-renders (columns added/removed)
  function invalidateAndUpdate() {
    _threshold = null;
    update();
  }

  // ── Wire up events ────────────────────────────────────────────────────────
  window.addEventListener('scroll',  update,            { passive: true });
  window.addEventListener('resize',  invalidateAndUpdate, { passive: true });
  projectBody?.addEventListener('scroll', update,        { passive: true });

  const board = document.querySelector('.project-tasks');
  if (board) {
    new MutationObserver(invalidateAndUpdate).observe(board, { childList: true, subtree: false });
  }

  // Initial call after a tick to let the board paint first
  requestAnimationFrame(update);
}());

