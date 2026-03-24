(function () {
  const STORAGE_KEY = 'qnotes_view';

  function syncDensityPicker(view) {
    document.querySelectorAll('.density-picker__opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
  }

  window.applyView = function(view, persist) {
    if (persist === undefined) persist = true;
    document.body.classList.remove('view-tight', 'view-cozy', 'view-roomy');
    if (['tight', 'cozy', 'roomy'].includes(view)) document.body.classList.add('view-' + view);
    syncDensityPicker(view);
    localStorage.setItem(STORAGE_KEY, view);
    if (persist && window.saveViewPreference) window.saveViewPreference(view);
  };

  // Restore saved preference (no Firestore write on initial load)
  window.applyView(localStorage.getItem(STORAGE_KEY) || 'cozy', false);

  // Density picker: trigger toggles open (touch/click), opts apply view + close
  document.addEventListener('click', e => {
    const picker  = document.getElementById('densityPicker');
    if (!picker) return;
    const opt     = e.target.closest('.density-picker__opt');
    const trigger = e.target.closest('.density-picker__trigger');
    if (opt) {
      window.applyView(opt.dataset.view);
      picker.classList.remove('open');
      document.getElementById('boardDropdown')?.classList.remove('open');
      return;
    }
    if (trigger) {
      const willOpen = !picker.classList.contains('open');
      window.closeAllPopups && window.closeAllPopups(['densityPicker']);
      picker.classList.toggle('open', willOpen);
      return;
    }
    if (!e.target.closest('.density-picker')) {
      picker.classList.remove('open');
    }
  });

  // Handle invite URL params — pre-fill register form with invited email
  (function() {
    const params = new URLSearchParams(window.location.search);
    const inviteEmail = params.get('invite');
    const inviteBoard = params.get('board');
    const inviteName  = params.get('bname');
    if (!inviteEmail) return;
    const regEmail     = document.getElementById('regEmail');
    const loginForm    = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const emailSection = document.getElementById('loginEmailSection');
    const banner       = document.getElementById('inviteBanner');
    if (regEmail)     regEmail.value = decodeURIComponent(inviteEmail);
    if (emailSection) emailSection.classList.add('open');
    if (loginForm)    loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = '';
    if (banner) {
      banner.style.display = '';
      const _bIcon = document.createElement('i');
      _bIcon.className = 'fas fa-envelope-open-text';
      banner.innerHTML = '';
      if (inviteName) {
        const _bBold = document.createElement('b');
        _bBold.textContent = inviteName;
        banner.append(_bIcon, document.createTextNode(" You've been invited to join "), _bBold);
      } else {
        banner.append(_bIcon, document.createTextNode(' You have a board invitation waiting'));
      }
    }
    if (inviteBoard) sessionStorage.setItem('pendingInviteBoard', decodeURIComponent(inviteBoard));
  })();
})();
