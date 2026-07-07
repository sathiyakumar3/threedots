// ── Mobile swipe column navigation ──────────────────────────────────────────
(function () {
  'use strict';

  const MOBILE_BP = 600;

  function isMobile() {
    return window.matchMedia('(max-width: ' + MOBILE_BP + 'px)').matches;
  }

  let dotsEl = null;

  function getColumns() {
    return [...document.querySelectorAll('.project-tasks > .project-column')];
  }

  function ensureDotsEl() {
    if (dotsEl && dotsEl.isConnected) return;
    dotsEl = document.createElement('div');
    dotsEl.id = 'mobileColDots';
    dotsEl.className = 'mobile-col-dots';
    const tasksEl = document.querySelector('.project-tasks');
    if (tasksEl && tasksEl.parentNode) {
      tasksEl.parentNode.insertBefore(dotsEl, tasksEl.nextSibling);
    }
  }

  function buildDots() {
    if (!isMobile()) return;
    ensureDotsEl();
    const tasksEl = document.querySelector('.project-tasks');
    const cols = getColumns();

    dotsEl.innerHTML = '';
    cols.forEach((col, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'mobile-col-dot';
      const label = col.querySelector('.project-column-heading__title')?.textContent?.trim() || ('Column ' + (i + 1));
      dot.setAttribute('aria-label', label);
      dot.title = label;
      dot.addEventListener('click', () => {
        if (!tasksEl) return;
        tasksEl.scrollTo({ left: i * tasksEl.clientWidth, behavior: 'smooth' });
      });
      dotsEl.appendChild(dot);
    });

    updateActiveDot();
  }

  function updateActiveDot() {
    if (!dotsEl) return;
    const tasksEl = document.querySelector('.project-tasks');
    if (!tasksEl) return;
    const colWidth = tasksEl.clientWidth;
    if (!colWidth) return;
    const activeIdx = Math.round(tasksEl.scrollLeft / colWidth);
    dotsEl.querySelectorAll('.mobile-col-dot').forEach((dot, i) => {
      dot.classList.toggle('mobile-col-dot--active', i === activeIdx);
    });
  }

  function init() {
    const tasksEl = document.querySelector('.project-tasks');
    if (!tasksEl) return;

    // Update active dot while user scrolls
    tasksEl.addEventListener('scroll', updateActiveDot, { passive: true });

    // Rebuild dots whenever columns are added or removed (Firebase loads them async)
    const observer = new MutationObserver(() => {
      if (isMobile()) buildDots();
    });
    observer.observe(tasksEl, { childList: true });

    if (isMobile()) buildDots();

    // Handle screen rotation / resize
    window.addEventListener('resize', () => {
      if (isMobile()) {
        buildDots();
      } else if (dotsEl) {
        dotsEl.innerHTML = '';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
