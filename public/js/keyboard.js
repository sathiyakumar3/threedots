// ── Keyboard shortcuts ────────────────────────────────────────────────────
(function () {
  document.addEventListener('DOMContentLoaded', () => {

    document.addEventListener('keydown', e => {
      const loginOverlay = document.getElementById('loginOverlay');
      if (loginOverlay && !loginOverlay.classList.contains('hidden')) return;

      const tag     = document.activeElement?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
      const modalOpen  = document.getElementById('modalOverlay')?.classList.contains('open');
      const sweetAlert = !!document.querySelector('.swal2-container');
      const calOpen    = document.getElementById('calOverlay')?.classList.contains('open');

      // ── Esc: close open modal / calendar / any popup ──────────────────
      if (e.key === 'Escape') {
        if (calOpen)    { document.getElementById('calCloseBtn')?.click(); return; }
        if (modalOpen)  { document.getElementById('modalOverlay')?.classList.remove('open'); return; }
        if (window.closeAllPopups) window.closeAllPopups();
        return;
      }

      // ── Type-anywhere search: any printable key opens and seeds search ─
      if (inInput || sweetAlert || modalOpen || calOpen) return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

      e.preventDefault();
      const char         = e.key;
      const topbarSearch = document.getElementById('topbarSearch');
      const searchInput  = document.getElementById('boardSearch');
      if (!topbarSearch || !searchInput) return;

      // Use the existing toggle so openSearch() handles focus timing correctly
      if (!topbarSearch.classList.contains('open')) {
        document.getElementById('searchToggle')?.click();
      }

      // Wait until after openSearch()'s own 50ms focus delay, then seed the value
      setTimeout(() => {
        searchInput.value = searchInput.value + char;
        searchInput.dispatchEvent(new Event('input'));
        searchInput.focus();
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }, 80);
    });
  });
}());
