// ── Keyboard shortcuts ────────────────────────────────────────────────────
(function () {
  document.addEventListener('DOMContentLoaded', () => {

    document.addEventListener('keydown', e => {
      // Disable all shortcuts on the login screen
      const loginOverlay = document.getElementById('loginOverlay');
      if (loginOverlay && !loginOverlay.classList.contains('hidden')) return;

      // Never fire when typing in an input / textarea / contenteditable
      const tag = document.activeElement?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
      // The modal / SweetAlert being open should also suppress most shortcuts
      const modalOpen  = document.getElementById('modalOverlay')?.classList.contains('open');
      const sweetAlert = !!document.querySelector('.swal2-container');
      const calOpen    = document.getElementById('calOverlay')?.classList.contains('open');

      // ── Esc: close open modal / calendar / any popup ─────────────────
      if (e.key === 'Escape') {
        if (calOpen) { document.getElementById('calCloseBtn')?.click(); return; }
        if (modalOpen) { document.getElementById('modalOverlay')?.classList.remove('open'); return; }
        // Close dropdowns / popups
        if (window.closeAllPopups) window.closeAllPopups();
        return;
      }

      // Everything below is suppressed while in inputs or dialogs
      if (inInput || sweetAlert) return;

      // ── / or Ctrl+K: focus search ─────────────────────────────────────
      if (e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        document.getElementById('searchToggle')?.click();
        return;
      }

      // ── N: open new-card modal ────────────────────────────────────────
      if (e.key === 'n' || e.key === 'N') {
        if (modalOpen || calOpen) return;
        document.getElementById('fabBtn')?.click();
        return;
      }

      // ── A: open activity panel ────────────────────────────────────────
      if (e.key === 'a' || e.key === 'A') {
        document.getElementById('activityToggle')?.click();
        return;
      }

      // ── C: open calendar ─────────────────────────────────────────────
      if (e.key === 'c' || e.key === 'C') {
        if (!calOpen) document.getElementById('calendarBtn')?.click();
        return;
      }

      // ── I: open board insights ────────────────────────────────────────
      if (e.key === 'i' || e.key === 'I') {
        document.getElementById('insightsBtn')?.click();
        return;
      }

      // ── D: toggle dark/light mode ─────────────────────────────────────
      if (e.key === 'd' || e.key === 'D') {
        document.getElementById('themeToggleBtn')?.click();
        return;
      }

      // ── F: toggle fullscreen ──────────────────────────────────────────
      if (e.key === 'f' || e.key === 'F') {
        document.getElementById('fullscreenBtn')?.click();
        return;
      }

      // ── G: toggle swimlane (group by tag) ────────────────────────────
      if (e.key === 'g' || e.key === 'G') {
        window._toggleSwimlane?.();
        return;
      }

      // ── ?: show keyboard shortcut cheatsheet ──────────────────────────
      if (e.key === '?') {
        showShortcuts();
        return;
      }
    });
  });

  document.getElementById('shortcutsBtn')?.addEventListener('click', function () {
    showShortcuts();
  });

  function showShortcuts() {
    if (typeof Swal === 'undefined') return;
    Swal.fire({
      title: '<i class="fas fa-keyboard"></i> Keyboard Shortcuts',
      html: `
        <table class="kbd-table">
          <tr><td><kbd>/</kbd> or <kbd>Ctrl K</kbd></td><td>Search cards</td></tr>
          <tr><td><kbd>N</kbd></td><td>New card</td></tr>
          <tr><td><kbd>A</kbd></td><td>Toggle Activity panel</td></tr>
          <tr><td><kbd>C</kbd></td><td>Open Calendar</td></tr>
          <tr><td><kbd>I</kbd></td><td>Board Insights</td></tr>
          <tr><td><kbd>D</kbd></td><td>Toggle Dark mode</td></tr>
          <tr><td><kbd>F</kbd></td><td>Toggle Fullscreen</td></tr>
          <tr><td><kbd>G</kbd></td><td>Toggle Swimlane (group by tag)</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Close modal / popup</td></tr>
          <tr><td><kbd>?</kbd></td><td>This help</td></tr>
        </table>`,
      confirmButtonText: 'Got it',
      confirmButtonColor: 'var(--purple)',
      customClass: { popup: 'kbd-shortcut-popup' }
    });
  }
}());
