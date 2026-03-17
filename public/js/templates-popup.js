// ── Templates Popup ───────────────────────────────────────────────────────
(function () {

  const tplBtn = document.getElementById('tplBtn');
  const popup  = document.getElementById('tplPopup');
  const listEl = document.getElementById('tplPopupList');

  function render(templates) {
    listEl.innerHTML = '';
    if (!templates.length) {
      listEl.innerHTML = '<p class="template-combo__empty">No saved templates yet.</p>';
      return;
    }
    templates.forEach(tpl => {
      const row = document.createElement('div');
      row.className = 'tags-row';

      const nameEl = document.createElement('span');
      nameEl.className   = 'tags-label';
      nameEl.textContent = tpl.name || tpl.title || 'Untitled';

      const delBtn = document.createElement('button');
      delBtn.type      = 'button';
      delBtn.className = 'tags-del-btn';
      delBtn.title     = 'Delete template';
      delBtn.innerHTML = '<i class="fas fa-times"></i>';

      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        const label = tpl.name || tpl.title || 'Untitled';
        Swal.fire({
          title: 'Delete template?',
          text: `"${label}" will be permanently removed.`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Delete',
          confirmButtonColor: '#e05252',
          cancelButtonText: 'Cancel',
          reverseButtons: true
        }).then(result => {
          if (!result.isConfirmed) return;
          if (typeof db === 'undefined' || !BOARD_ID) return;
          db.collection(`boards/${BOARD_ID}/templates`).doc(tpl.id).delete()
            .then(() => {
              loadAndRender();
              // If the add-card modal is open and showing the template combo, refresh it
              if (typeof window._refreshTemplateCombo === 'function') {
                window._refreshTemplateCombo();
              }
            })
            .catch(err => console.error('Delete template error:', err));
        });
      });

      row.appendChild(nameEl);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  }

  function loadAndRender() {
    if (typeof db === 'undefined' || !BOARD_ID) {
      listEl.innerHTML = '<p class="template-combo__empty">No board loaded.</p>';
      return;
    }
    db.collection(`boards/${BOARD_ID}/templates`).get()
      .then(snap => {
        const templates = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        render(templates);
      })
      .catch(err => {
        console.error('Templates popup load error:', err);
        listEl.innerHTML = '<p class="template-combo__empty">Failed to load templates.</p>';
      });
  }

  tplBtn.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = !popup.classList.contains('open');
    window.closeAllPopups && window.closeAllPopups(['tplPopup']);
    popup.classList.toggle('open', willOpen);
    tplBtn.classList.toggle('open', willOpen);
    if (willOpen) loadAndRender();
  });

  document.addEventListener('click', e => {
    if (!popup.contains(e.target) && !tplBtn.contains(e.target)) {
      popup.classList.remove('open');
      tplBtn.classList.remove('open');
    }
  });

})();
