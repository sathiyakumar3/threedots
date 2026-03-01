// ── Tags Manager ─────────────────────────────────────────────────────────
(function () {

  const DEFAULT_TAGS = [
    { id: 'urgent',      label: 'Urgent',      color: '#ff595e' },
    { id: 'onhold',      label: 'On Hold',     color: '#ff924c' },
    { id: 'task',        label: 'Task',        color: '#ffca3a' },
    { id: 'maintenance', label: 'Maintenance', color: '#c5ca30' },
    { id: 'operation',  label: 'Operation',  color: '#8ac926' },
    { id: 'support',     label: 'Support',     color: '#36949d' },
    { id: 'design',      label: 'Design',      color: '#1982c4' },
    { id: 'feature',     label: 'Feature',     color: '#4267ac' },
    { id: 'issue',      label: 'Issue',      color: '#565aa0' },
    { id: 'report',      label: 'Report',      color: '#6a4c93' },
  ];

  let activeTags = JSON.parse(JSON.stringify(DEFAULT_TAGS));

  // ── Dynamic stylesheet for tag colours ──
  const dynStyle = document.createElement('style');
  document.head.appendChild(dynStyle);

  // Gamma-corrected perceived luminance (SO #3942878 — most perceptually accurate)
  // Weights: green (0.587) > red (0.299) > blue (0.114), matching human eye sensitivity
  function tagTextColor(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.length === 3 ? c[0]+c[0] : c.slice(0,2), 16);
    const g = parseInt(c.length === 3 ? c[1]+c[1] : c.slice(2,4), 16);
    const b = parseInt(c.length === 3 ? c[2]+c[2] : c.slice(4,6), 16);
    const luminance = Math.sqrt(0.299 * r*r + 0.587 * g*g + 0.114 * b*b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  function applyTagStyles(tags) {
    dynStyle.textContent = tags.map(t =>
      `.task__tag--${t.id} { background:${t.color}; color:${tagTextColor(t.color)}; }`
    ).join('\n');
  }

  function syncTagLabels(tags) {
    // Wipe + rebuild the shared global object
    Object.keys(tagLabels).forEach(k => delete tagLabels[k]);
    tags.forEach(t => { tagLabels[t.id] = t.label; });
  }

  function refreshModalSelect(tags) {
    const wrap = document.getElementById('cardTag');
    if (!wrap) return;
    const picker = wrap.querySelector('.tag-picker');
    if (!picker) return;
    const t = tags.find(t => t.id === picker.dataset.value) || tags[0];
    if (!t) return;
    const sw = picker.querySelector('.tag-picker__trigger .tags-swatch');
    const lb = picker.querySelector('.tag-picker__label');
    if (sw) sw.style.background = t.color;
    if (lb) lb.textContent = t.label;
  }

  function refreshCardLabels(tags) {
    const map = {};
    tags.forEach(t => { map[t.id] = t; });
    document.querySelectorAll('.task__tag').forEach(el => {
      const cls = [...el.classList].find(c => c.startsWith('task__tag--'));
      if (!cls) return;
      const id = cls.replace('task__tag--', '');
      if (map[id]) el.textContent = map[id].label;
    });
  }

  function applyAll(tags) {
    activeTags = tags;
    applyTagStyles(tags);
    syncTagLabels(tags);
    refreshModalSelect(tags);
    refreshCardLabels(tags);
  }

  // ── Firestore persistence ──
  function loadTagsFromFirestore() {
    // Tags are now per-board; just reset to defaults until a board loads
    applyAll(JSON.parse(JSON.stringify(DEFAULT_TAGS)));
  }

  function saveToFirestore() {
    if (!BOARD_ID) return;
    db.doc(`boards/${BOARD_ID}`)
      .update({ tags: activeTags })
      .catch(err => console.error('Tag save error:', err));
  }

  // ── Render popup list ──
  const listEl   = document.getElementById('tagsPopupList');
  const newInput = document.getElementById('tagsNewInput');
  const newAdd   = document.getElementById('tagsNewAdd');
  const tagsBtn  = document.getElementById('tagsBtn');
  const popup    = document.getElementById('tagsPopup');

  function renderList() {
    listEl.innerHTML = '';
    activeTags.forEach((tag, idx) => {
      const row = document.createElement('div');
      row.className = 'tags-row';

      // — Colour swatch (wraps hidden color input) —
      const swatchWrap  = document.createElement('label');
      swatchWrap.className = 'tags-swatch-wrap';
      swatchWrap.title  = 'Change colour';

      const colorInput  = document.createElement('input');
      colorInput.type   = 'text';
      colorInput.value  = tag.color;
      colorInput.className = 'tags-color-input';
      colorInput.setAttribute('data-coloris', '');

      const swatch = document.createElement('span');
      swatch.className = 'tags-swatch';
      swatch.style.background = tag.color;

      colorInput.addEventListener('input', e => {
        swatch.style.background = e.target.value;
      });
      colorInput.addEventListener('change', e => {
        activeTags[idx].color = e.target.value;
        saveToFirestore();
        applyAll([...activeTags]);
        renderList();
      });

      swatchWrap.appendChild(colorInput);
      swatchWrap.appendChild(swatch);

      // — Editable label —
      const labelEl = document.createElement('span');
      labelEl.className   = 'tags-label';
      labelEl.textContent = tag.label;
      labelEl.title = 'Click to rename';

      labelEl.addEventListener('click', e => {
        e.stopPropagation();
        const inp = document.createElement('input');
        inp.type      = 'text';
        inp.className = 'tags-rename-input';
        inp.value     = tag.label;
        labelEl.replaceWith(inp);
        inp.focus();
        inp.select();

        const commit = () => {
          const val = inp.value.trim();
          if (val) activeTags[idx].label = val;
          saveToFirestore();
          applyAll([...activeTags]);
          renderList();
        };
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
          if (e.key === 'Escape') { inp.value = tag.label; inp.blur(); }
        });
      });

      // — Delete button —
      const delBtn  = document.createElement('button');
      delBtn.className = 'tags-del-btn';
      delBtn.title  = 'Delete tag';
      delBtn.innerHTML = '<i class="fas fa-times"></i>';
      delBtn.addEventListener('click', () => {
        if (activeTags.length <= 1) return;
        Swal.fire({
          title: 'Are you sure?',
          text: `Delete the "${tag.label}" tag?`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Delete',
          confirmButtonColor: '#e05252',
          cancelButtonText: 'Cancel',
          reverseButtons: true
        }).then(result => {
          if (!result.isConfirmed) return;
          activeTags.splice(idx, 1);
          saveToFirestore();
          applyAll([...activeTags]);
          renderList();
        });
      });

      row.appendChild(swatchWrap);
      row.appendChild(labelEl);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  }

  // ── Color themes ──
  const COLOR_THEMES = [
    { name: 'Chemical Overdoze', colors: ['#001219','#005f73','#0a9396','#94d2bd','#e9d8a6','#ee9b00','#ca6702','#bb3e03','#ae2012','#9b2226'] },
    { name: 'Vibrant Sunset',   colors: ['#ff6b6b','#ee5a24','#f79f1f','#ffd32a','#c4e538','#009432','#0652dd','#833471','#fd79a8','#e84393'] },
    { name: 'Autumn Harvest', colors: ['#2d4a2a','#4a6741','#758c3c','#c9b800','#f5c842','#f4a03a','#e07b39','#c84b0f','#9e3507','#6d2b0c'] },
    { name: 'Soft Pastel',      colors: ['#ffb3c1','#ffcfd2','#fde4cf','#fbf8cc','#b9fbc0','#98f5e1','#8eecf5','#90dbf4','#a2c4c9','#cfbaf0'] },
    { name: 'Sunshine Joy',    colors: ['#ffc300','#ffb703','#e85d04','#9d0208','#6a040f','#370617','#0d2c54','#001d3d','#000814','#000814'] },
    { name: 'Light Pearls',      colors: ['#1a535c','#349090','#4ecdc4','#a3e6de','#f7fff7','#fbb5b1','#ff6b6b','#ffa96c','#ffe66d','#ffe66d'] },
    { name: 'Earthly Tones',    colors: ['#c6d9df','#f1e3d0','#94baad','#706993','#70a0af','#b85e25','#dfaf6a','#762852','#04395e','#04395e'] },
  ];

  let activeThemeName = null;

  function applyColorTheme(theme) {
    activeThemeName = theme.name;
    theme.colors.forEach((color, i) => {
      if (activeTags[i]) activeTags[i].color = color;
    });
    saveToFirestore();
    applyAll([...activeTags]);
    renderList();
    renderThemes();
    // Refresh + close themes panel in all tag-picker instances
    document.querySelectorAll('.tag-picker').forEach(p => {
      const themesPanel = p.querySelector('.tag-picker__themes');
      const paletteBtn  = p.querySelector('.tag-picker__palette-btn');
      const themesListEl= p.querySelector('.tag-picker__themes-list');
      if (themesListEl) renderThemes(themesListEl);
      if (themesPanel)  themesPanel.classList.remove('tags-themes--open');
      if (paletteBtn)   paletteBtn.classList.remove('active');
      // Refresh the tag list so swatches reflect new colors
      const pickerInstance = p;
      const listInner = p.querySelector('.tag-picker__list');
      if (listInner) {
        // Re-fire the trigger's renderPickerList by dispatching a soft refresh
        // We update swatches directly to avoid full re-render losing open state
        p.querySelectorAll('.tag-picker__row-item').forEach((row, idx) => {
          if (activeTags[idx]) {
            const sw = row.querySelector('.tags-swatch');
            if (sw) sw.style.background = activeTags[idx].color;
          }
        });
        // Update trigger swatch too
        const trigSwatch = p.querySelector('.tag-picker__trigger .tags-swatch');
        const val = p.dataset.value;
        const t = activeTags.find(t => t.id === val) || activeTags[0];
        if (trigSwatch && t) trigSwatch.style.background = t.color;
      }
    });
  }

  function renderThemes(targetEl) {
    const listEl = targetEl || document.getElementById('tagsThemesList');
    if (!listEl) return;
    listEl.innerHTML = '';
    COLOR_THEMES.forEach(theme => {
      const row = document.createElement('div');
      row.className = 'tags-theme-row' + (theme.name === activeThemeName ? ' active' : '');
      const preview = document.createElement('div');
      preview.className = 'tags-theme-row__preview';
      preview.style.background = `linear-gradient(to right, ${theme.colors.slice(0,10).join(', ')})`;
      const label = document.createElement('span');
      label.className = 'tags-theme-row__name';
      label.textContent = theme.name;
      row.appendChild(preview);
      row.appendChild(label);
      if (theme.name === activeThemeName) {
        const check = document.createElement('i');
        check.className = 'fas fa-check tags-theme-row__check';
        row.appendChild(check);
      }
      row.addEventListener('click', () => applyColorTheme(theme));
      listEl.appendChild(row);
    });
  }


  // ── Add new tag ──
  function addNewTag() {
    const name = newInput.value.trim();
    if (!name) { newInput.focus(); return; }
    const raw  = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const id   = raw || ('tag' + Date.now());
    if (activeTags.find(t => t.id === id)) {
      newInput.select();
      return;
    }
    // Pick next color from active theme, or fallback rainbow
    const fallback = ['#ff595e','#ff924c','#ffca3a','#8ac926','#1982c4','#6a4c93','#36949d','#565aa0'];
    const pool = activeThemeName
      ? (COLOR_THEMES.find(t => t.name === activeThemeName)?.colors || fallback)
      : fallback;
    const color = pool[activeTags.length % pool.length];
    activeTags.push({ id, label: name, color });
    saveToFirestore();
    applyAll([...activeTags]);
    renderList();
    newInput.value = '';
    newInput.focus();
    // Scroll list to bottom
    listEl.scrollTop = listEl.scrollHeight;
  }

  newAdd.addEventListener('click', addNewTag);
  newInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addNewTag(); }
  });

  // ── Toggle popup ──
  tagsBtn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = popup.classList.toggle('open');
    tagsBtn.classList.toggle('open', isOpen);
    if (isOpen) { renderList(); renderThemes(); setTimeout(() => newInput.focus(), 50); }
  });

  // Color Themes toggle
  document.getElementById('tagsThemesToggle')?.addEventListener('click', e => {
    e.stopPropagation();
    const themesEl = document.getElementById('tagsThemesPanel');
    const isOpen = themesEl.classList.toggle('tags-themes--open');
    document.getElementById('tagsThemesToggle').classList.toggle('active', isOpen);
  });

  document.addEventListener('click', e => {
    if (!popup.contains(e.target) && !tagsBtn.contains(e.target)) {
      popup.classList.remove('open');
      // Also collapse the themes side-panel
      const themesEl = document.getElementById('tagsThemesPanel');
      if (themesEl) { themesEl.classList.remove('tags-themes--open'); }
      const toggleBtn = document.getElementById('tagsThemesToggle');
      if (toggleBtn) { toggleBtn.classList.remove('active'); }
      tagsBtn.classList.remove('open');
    }
  });

  // ── Public hook called after login ──
  window._loadUserTags   = uid => loadTagsFromFirestore(uid);
  window._getActiveTags  = ()   => JSON.parse(JSON.stringify(activeTags));
  window._getDefaultTags = ()   => JSON.parse(JSON.stringify(DEFAULT_TAGS));
  window._applyBoardTags = tags => {
    if (Array.isArray(tags) && tags.length) applyAll(JSON.parse(JSON.stringify(tags)));
  };

  // ── Custom tag picker ──
  window._createTagPicker = function(initialId, containerEl) {
    const id = initialId || activeTags[0]?.id || '';
    const picker = document.createElement('div');
    picker.className = 'tag-picker';
    picker.dataset.value = id;

    function getTag(tid) { return activeTags.find(t => t.id === tid) || activeTags[0]; }

    const t0 = getTag(id);
    picker.innerHTML = `
      <button type="button" class="tag-picker__trigger">
        <span class="tags-swatch" style="background:${t0?.color || '#ccc'}"></span>
        <span class="tag-picker__label">${t0?.label || ''}</span>
        <i class="fas fa-chevron-down tag-picker__arrow"></i>
      </button>
      <div class="tag-picker__dropdown">
        <div class="tags-popup__title">
          Tag
          <button type="button" class="tags-themes__icon-btn tag-picker__palette-btn" title="Color Themes">
            <i class="fas fa-palette"></i>
          </button>
        </div>
        <div class="tags-list tag-picker__list"></div>
        <div class="tags-popup__footer">
          <div class="tags-popup__new-row">
            <input type="text" class="tags-new-input tag-picker__new-input" placeholder="New tag name…" autocomplete="off">
            <button type="button" class="tags-new-add tag-picker__new-add" title="Add tag"><i class="fas fa-plus"></i></button>
          </div>
        </div>
      </div>
      <div class="tags-themes tag-picker__themes">
        <div class="tags-themes__title">Color Themes</div>
        <div class="tags-themes__list tag-picker__themes-list"></div>
      </div>`;

    const trigger     = picker.querySelector('.tag-picker__trigger');
    const dropdown    = picker.querySelector('.tag-picker__dropdown');
    const listEl      = picker.querySelector('.tag-picker__list');
    const newInput    = picker.querySelector('.tag-picker__new-input');
    const newAdd      = picker.querySelector('.tag-picker__new-add');
    const paletteBtn  = picker.querySelector('.tag-picker__palette-btn');
    const themesPanel = picker.querySelector('.tag-picker__themes');
    const themesListEl= picker.querySelector('.tag-picker__themes-list');

    function closePickerPanels() {
      dropdown.classList.remove('open');
      trigger.classList.remove('open');
      themesPanel.classList.remove('tags-themes--open');
      paletteBtn.classList.remove('active');
    }

    function updateTrigger() {
      const t = getTag(picker.dataset.value);
      if (!t) return;
      trigger.querySelector('.tags-swatch').style.background = t.color;
      trigger.querySelector('.tag-picker__label').textContent = t.label;
    }

    function renderPickerList() {
      listEl.innerHTML = '';
      activeTags.forEach((tag, idx) => {
        const row = document.createElement('div');
        row.className = 'tags-row tag-picker__row-item' + (tag.id === picker.dataset.value ? ' tag-picker__row-item--active' : '');

        // Swatch + color input
        const swatchWrap = document.createElement('label');
        swatchWrap.className = 'tags-swatch-wrap';
        swatchWrap.title = 'Change colour';
        const colorInput = document.createElement('input');
        colorInput.type = 'text';
        colorInput.value = tag.color;
        colorInput.className = 'tags-color-input';
        colorInput.setAttribute('data-coloris', '');
        const swatch = document.createElement('span');
        swatch.className = 'tags-swatch';
        swatch.style.background = tag.color;
        colorInput.addEventListener('input', e => { swatch.style.background = e.target.value; });
        colorInput.addEventListener('change', e => {
          activeTags[idx].color = e.target.value;
          saveToFirestore();
          applyAll([...activeTags]);
          updateTrigger();
          renderPickerList();
        });
        swatchWrap.appendChild(colorInput);
        swatchWrap.appendChild(swatch);

        // Label (click = select; dblclick = rename)
        const labelEl = document.createElement('span');
        labelEl.className = 'tags-label';
        labelEl.textContent = tag.label;
        labelEl.title = 'Click to select · Double-click to rename';
        labelEl.addEventListener('click', e => {
          e.stopPropagation();
          picker.dataset.value = tag.id;
          updateTrigger();
          renderPickerList();
          closePickerPanels();
        });
        labelEl.addEventListener('dblclick', e => {
          e.stopPropagation();
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'tags-rename-input';
          inp.value = tag.label;
          labelEl.replaceWith(inp);
          inp.focus(); inp.select();
          const commit = () => {
            const val = inp.value.trim();
            if (val) activeTags[idx].label = val;
            saveToFirestore();
            applyAll([...activeTags]);
            updateTrigger();
            renderPickerList();
          };
          inp.addEventListener('blur', commit);
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
            if (e.key === 'Escape') { inp.value = tag.label; inp.blur(); }
          });
        });

        // Delete
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'tags-del-btn';
        delBtn.title = 'Delete tag';
        delBtn.innerHTML = '<i class="fas fa-times"></i>';
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (activeTags.length <= 1) return;
          if (picker.dataset.value === tag.id) picker.dataset.value = activeTags.find(t => t.id !== tag.id)?.id || '';
          activeTags.splice(idx, 1);
          saveToFirestore();
          applyAll([...activeTags]);
          updateTrigger();
          renderPickerList();
        });

        row.appendChild(swatchWrap);
        row.appendChild(labelEl);
        row.appendChild(delBtn);
        listEl.appendChild(row);
      });
      // Re-bind Coloris to newly created inputs
      if (window.Coloris) Coloris({ el: '.tags-color-input' });
    }

    function addNewTag() {
      const name = newInput.value.trim();
      if (!name) { newInput.focus(); return; }
      const raw = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const tid = raw || ('tag' + Date.now());
      if (activeTags.find(t => t.id === tid)) { newInput.select(); return; }
      const PALETTE = ['#e91e63','#9c27b0','#3f51b5','#2196f3','#00bcd4','#4caf50','#ff9800','#795548'];
      const color = PALETTE[activeTags.length % PALETTE.length];
      activeTags.push({ id: tid, label: name, color });
      picker.dataset.value = tid;
      saveToFirestore();
      applyAll([...activeTags]);
      updateTrigger();
      renderPickerList();
      newInput.value = '';
      newInput.focus();
      listEl.scrollTop = listEl.scrollHeight;
    }

    newAdd.addEventListener('click', e => { e.stopPropagation(); addNewTag(); });
    newInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); addNewTag(); }
    });
    newInput.addEventListener('click', e => e.stopPropagation());

    paletteBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = themesPanel.classList.toggle('tags-themes--open');
      paletteBtn.classList.toggle('active', isOpen);
      if (isOpen) renderThemes(themesListEl);
    });

    picker.addEventListener('click', e => e.stopPropagation());

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = !dropdown.classList.contains('open');
      // Close all other open pickers
      document.querySelectorAll('.tag-picker').forEach(p => {
        if (p !== picker) {
          p.querySelector('.tag-picker__dropdown')?.classList.remove('open');
          p.querySelector('.tag-picker__trigger')?.classList.remove('open');
          p.querySelector('.tag-picker__themes')?.classList.remove('tags-themes--open');
          p.querySelector('.tag-picker__palette-btn')?.classList.remove('active');
        }
      });
      if (willOpen) {
        renderPickerList();
        renderThemes(themesListEl);
        dropdown.classList.add('open');
        trigger.classList.add('open');
      } else {
        closePickerPanels();
      }
    });

    document.addEventListener('click', () => closePickerPanels());

    if (containerEl) {
      containerEl.innerHTML = '';
      containerEl.appendChild(picker);
    }
    return picker;
  };

  // ── Inline tag picker (embedded flat list used in the Add/Edit card modal) ──
  window._createInlineTagPicker = function(initialId, containerEl) {
    const id = initialId || activeTags[0]?.id || '';
    const picker = document.createElement('div');
    picker.className = 'modal-inline-tag-picker';
    picker.dataset.value = id;

    function getTag(tid) { return activeTags.find(t => t.id === tid) || activeTags[0]; }

    picker.innerHTML = `
      <div class="tags-list modal-inline-tag-picker__list"></div>
      <div class="modal-inline-tag-picker__footer">
        <input type="text" class="tags-new-input modal-inline-tag-picker__new-input" placeholder="New tag…" autocomplete="off">
        <button type="button" class="tags-new-add modal-inline-tag-picker__new-add" title="Add tag"><i class="fas fa-plus"></i></button>
      </div>`;

    const listEl   = picker.querySelector('.modal-inline-tag-picker__list');
    const newInput = picker.querySelector('.modal-inline-tag-picker__new-input');
    const newAdd   = picker.querySelector('.modal-inline-tag-picker__new-add');

    function renderList() {
      listEl.innerHTML = '';
      activeTags.forEach((tag, idx) => {
        const row = document.createElement('div');
        row.className = 'tags-row tag-picker__row-item' + (tag.id === picker.dataset.value ? ' tag-picker__row-item--active' : '');

        const swatchWrap = document.createElement('label');
        swatchWrap.className = 'tags-swatch-wrap';
        swatchWrap.title = 'Change colour';
        const colorInput = document.createElement('input');
        colorInput.type = 'text';
        colorInput.value = tag.color;
        colorInput.className = 'tags-color-input';
        colorInput.setAttribute('data-coloris', '');
        const swatch = document.createElement('span');
        swatch.className = 'tags-swatch';
        swatch.style.background = tag.color;
        colorInput.addEventListener('input', e => { swatch.style.background = e.target.value; });
        colorInput.addEventListener('change', e => {
          activeTags[idx].color = e.target.value;
          saveToFirestore();
          applyAll([...activeTags]);
          renderList();
        });
        swatchWrap.appendChild(colorInput);
        swatchWrap.appendChild(swatch);

        const labelEl = document.createElement('span');
        labelEl.className = 'tags-label';
        labelEl.textContent = tag.label;
        labelEl.title = 'Click to select · Double-click to rename';
        labelEl.addEventListener('click', e => {
          e.stopPropagation();
          picker.dataset.value = tag.id;
          renderList();
        });
        labelEl.addEventListener('dblclick', e => {
          e.stopPropagation();
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'tags-rename-input';
          inp.value = tag.label;
          labelEl.replaceWith(inp);
          inp.focus(); inp.select();
          const commit = () => {
            const val = inp.value.trim();
            if (val) activeTags[idx].label = val;
            saveToFirestore();
            applyAll([...activeTags]);
            renderList();
          };
          inp.addEventListener('blur', commit);
          inp.addEventListener('keydown', ev => {
            if (ev.key === 'Enter')  { ev.preventDefault(); inp.blur(); }
            if (ev.key === 'Escape') { inp.value = tag.label; inp.blur(); }
          });
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'tags-del-btn';
        delBtn.title = 'Delete tag';
        delBtn.innerHTML = '<i class="fas fa-times"></i>';
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (activeTags.length <= 1) return;
          if (picker.dataset.value === tag.id) picker.dataset.value = activeTags.find(t => t.id !== tag.id)?.id || '';
          activeTags.splice(idx, 1);
          saveToFirestore();
          applyAll([...activeTags]);
          renderList();
        });

        row.appendChild(swatchWrap);
        row.appendChild(labelEl);
        row.appendChild(delBtn);
        listEl.appendChild(row);
      });
      if (window.Coloris) Coloris({ el: '.tags-color-input' });
    }

    function addNewTag() {
      const name = newInput.value.trim();
      if (!name) { newInput.focus(); return; }
      const raw = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const tid = raw || ('tag' + Date.now());
      if (activeTags.find(t => t.id === tid)) { newInput.select(); return; }
      const PALETTE = ['#e91e63','#9c27b0','#3f51b5','#2196f3','#00bcd4','#4caf50','#ff9800','#795548'];
      const color = PALETTE[activeTags.length % PALETTE.length];
      activeTags.push({ id: tid, label: name, color });
      picker.dataset.value = tid;
      saveToFirestore();
      applyAll([...activeTags]);
      renderList();
      newInput.value = '';
      newInput.focus();
      listEl.scrollTop = listEl.scrollHeight;
    }

    newAdd.addEventListener('click', e => { e.stopPropagation(); addNewTag(); });
    newInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); addNewTag(); }
    });
    newInput.addEventListener('click', e => e.stopPropagation());

    renderList();

    if (containerEl) {
      containerEl.innerHTML = '';
      containerEl.appendChild(picker);
    }
    return picker;
  };

  // Apply defaults immediately (before auth resolves)
  applyAll(DEFAULT_TAGS);

  // ── Coloris colour picker init ──
  if (window.Coloris) {
    const isDark = document.body.classList.contains('dark');
    Coloris({
      el: '.tags-color-input',
      alpha: false,
      format: 'hex',
      themeMode: isDark ? 'dark' : 'light',
      closeButton: true,
      closeButtonLabel: 'Pick',
      clearButton: false,
    });
  }

}());
