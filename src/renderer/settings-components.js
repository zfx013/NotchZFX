// Composants generiques de la fenetre Parametres.
// Chaque `type` de ligne du schema est rendu par une fonction ci-dessous.
// Tout passe par window.SettingsComponents.renderRow(row, ctx).
//
// ctx = {
//   getPref(key), setPref(key, value, opts?),   // opts.rerender (defaut true)
//   info,                                         // resultat de getInfo()
// }

(function () {
  // --------------------------------------------------------- Icones (sidebar)
  // Petites icones inline facon SF Symbols pour la barre laterale.
  const ICONS = {
    general:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z"/><path d="M19.4 13a7.6 7.6 0 0 0 .05-2l1.6-1.25-1.6-2.77-1.9.76a7.5 7.5 0 0 0-1.73-1l-.28-2.01h-3.2l-.28 2a7.5 7.5 0 0 0-1.73 1l-1.9-.75-1.6 2.77L6.55 11a7.6 7.6 0 0 0 0 2l-1.6 1.25 1.6 2.77 1.9-.76c.52.42 1.1.76 1.73 1l.28 2.01h3.2l.28-2c.63-.25 1.2-.6 1.73-1l1.9.75 1.6-2.77z"/></svg>',
    appearance:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20s2-1 4-1 3 1 5 1 4-2 4-4c0-1.5-1-2.5-2.5-3"/><path d="M14.5 3.5 3.5 14.5 6 17l11-11z"/><path d="M12 6l3 3"/></svg>',
    media:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 17.3V5.6a.8.8 0 0 1 .63-.78l9-2A.8.8 0 0 1 20.1 3.6v11.2a3.05 3.05 0 1 1-1.6-2.69V6.6l-7.4 1.64v10.56a3.05 3.05 0 1 1-1.6-2.69z"/></svg>',
    calendar:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9h17M8 3v3M16 3v3"/></svg>',
    huds:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2.2" fill="currentColor"/><circle cx="15" cy="16" r="2.2" fill="currentColor"/></svg>',
    battery:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7.5" width="16" height="9" rx="2.5"/><path d="M21 10.5v3"/><rect x="4.5" y="9.5" width="8" height="5" rx="1" fill="currentColor" stroke="none"/></svg>',
    shelf:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 13.5h4a4.5 4.5 0 0 0 9 0h4"/><path d="M4 13.5 6 5.5a1.6 1.6 0 0 1 1.55-1.2h8.9A1.6 1.6 0 0 1 18 5.5l2 8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>',
    shortcuts:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M8 13h8"/></svg>',
    advanced:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6M6 14v6M12 4v3M12 11v9M18 4v9M18 17v3"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="18" cy="15" r="2"/></svg>',
    sync:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9a8 8 0 0 1 13.5-3.5L20 8"/><path d="M20 4v4h-4"/><path d="M20 15a8 8 0 0 1-13.5 3.5L4 16"/><path d="M4 20v-4h4"/></svg>',
    about:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.7" r="1" fill="currentColor" stroke="none"/></svg>',
    xmark:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  function iconSvg(name) {
    return ICONS[name] || '';
  }

  // --------------------------------------------------------------- Utilitaires
  // Resout une valeur qui peut etre une fonction de ctx.
  function resolve(v, ctx) {
    return typeof v === 'function' ? v(ctx) : v;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Bloc texte gauche d'une ligne (label + description eventuelle + badge).
  function labelBlock(row, ctx) {
    const block = el('div', 'row-text');
    const top = el('div', 'row-label-line');
    top.appendChild(el('span', 'row-label', resolve(row.label, ctx)));
    if (row.badge) top.appendChild(el('span', 'badge', row.badge));
    block.appendChild(top);
    const desc = resolve(row.desc, ctx);
    if (desc) block.appendChild(el('div', 'row-desc', desc));
    return block;
  }

  // Enveloppe standard d'une ligne : texte a gauche, controle a droite.
  function rowShell(row, ctx, control) {
    const r = el('div', 'row');
    if (resolve(row.disabled, ctx)) r.classList.add('is-disabled');
    r.appendChild(labelBlock(row, ctx));
    if (control) {
      const right = el('div', 'row-control');
      right.appendChild(control);
      r.appendChild(right);
    }
    return r;
  }

  // Symboles clavier pour l'affichage des raccourcis.
  function prettyShortcut(str) {
    if (!str) return '';
    return str
      .split('+')
      .map((p) => {
        const k = p.trim().toLowerCase();
        if (k === 'cmd' || k === 'command' || k === 'meta') return '⌘';
        if (k === 'shift') return '⇧';
        if (k === 'ctrl' || k === 'control') return '⌃';
        if (k === 'alt' || k === 'option' || k === 'opt') return '⌥';
        return p.trim().toUpperCase();
      })
      .join('');
  }

  // --------------------------------------------------------------- Composants
  const renderers = {
    // ---- Interrupteur iOS
    toggle(row, ctx) {
      const sw = el('label', 'switch');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = !!ctx.getPref(row.key);
      input.disabled = !!resolve(row.disabled, ctx);
      input.addEventListener('change', () => ctx.setPref(row.key, input.checked));
      sw.appendChild(input);
      sw.appendChild(el('span', 'switch-track'));
      return rowShell(row, ctx, sw);
    },

    // ---- Menu deroulant facon macOS
    dropdown(row, ctx) {
      const wrap = el('div', 'select');
      const sel = el('select');
      sel.disabled = !!resolve(row.disabled, ctx);
      const opts = resolve(row.options, ctx) || [];
      const cur = ctx.getPref(row.key);
      for (const [value, label] of opts) {
        const o = el('option', null, label);
        o.value = value;
        if (value === cur) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => ctx.setPref(row.key, sel.value));
      wrap.appendChild(sel);
      wrap.appendChild(el('span', 'select-chevron'));
      return rowShell(row, ctx, wrap);
    },

    // ---- Curseur (continu ou discret a 3 crans)
    slider(row, ctx) {
      const wrap = el('div', 'slider');
      const input = el('input');
      input.type = 'range';
      const value = el('span', 'slider-value');

      if (row.discrete) {
        // Ex. sensibilite des gestes : indices mappes sur des libelles.
        const list = row.discrete;
        const labels = row.discreteLabels || list;
        input.min = 0;
        input.max = list.length - 1;
        input.step = 1;
        let idx = list.indexOf(ctx.getPref(row.key));
        if (idx < 0) idx = 0;
        input.value = idx;
        value.textContent = labels[idx];
        input.addEventListener('input', () => { value.textContent = labels[+input.value]; });
        input.addEventListener('change', () => ctx.setPref(row.key, list[+input.value], { rerender: false }));
      } else {
        input.min = row.min;
        input.max = row.max;
        input.step = row.step;
        input.value = ctx.getPref(row.key);
        const fmt = row.format || ((v) => String(v));
        value.textContent = fmt(input.value);
        input.addEventListener('input', () => { value.textContent = fmt(input.value); });
        input.addEventListener('change', () => ctx.setPref(row.key, parseFloat(input.value), { rerender: false }));
      }
      input.disabled = !!resolve(row.disabled, ctx);
      wrap.appendChild(input);
      wrap.appendChild(value);
      return rowShell(row, ctx, wrap);
    },

    // ---- Incrementeur numerique (-/valeur/+)
    stepper(row, ctx) {
      const wrap = el('div', 'stepper');
      const dec = el('button', 'stepper-btn', '−');
      const val = el('span', 'stepper-value');
      const inc = el('button', 'stepper-btn', '+');
      const render = () => {
        const v = ctx.getPref(row.key);
        val.textContent = v + (row.suffix || '');
      };
      dec.addEventListener('click', () => {
        const v = Math.max(row.min, ctx.getPref(row.key) - (row.step || 1));
        ctx.setPref(row.key, v, { rerender: false });
        render();
      });
      inc.addEventListener('click', () => {
        const v = Math.min(row.max, ctx.getPref(row.key) + (row.step || 1));
        ctx.setPref(row.key, v, { rerender: false });
        render();
      });
      render();
      wrap.appendChild(dec);
      wrap.appendChild(val);
      wrap.appendChild(inc);
      return rowShell(row, ctx, wrap);
    },

    // ---- Controle segmente (System / Custom)
    segmented(row, ctx) {
      const wrap = el('div', 'segmented');
      const cur = ctx.getPref(row.key);
      for (const [value, label] of resolve(row.options, ctx) || []) {
        const b = el('button', 'seg-item', label);
        if (value === cur) b.classList.add('is-on');
        b.addEventListener('click', () => ctx.setPref(row.key, value));
        wrap.appendChild(b);
      }
      return rowShell(row, ctx, wrap);
    },

    // ---- Champ de raccourci clavier
    keybind(row, ctx) {
      const wrap = el('div', 'keybind');
      const badge = el('button', 'keybind-badge');
      const value = ctx.getPref(row.key);
      badge.textContent = value ? prettyShortcut(value) : 'Enregistrer';
      if (!value) badge.classList.add('is-empty');

      // Capture clavier au clic (optionnelle mais fonctionnelle).
      badge.addEventListener('click', () => {
        badge.textContent = '...';
        badge.classList.add('is-recording');
        const onKey = (ev) => {
          ev.preventDefault();
          const k = ev.key;
          if (k === 'Escape') { cleanup(); ctx.rerender(); return; }
          if (['Shift', 'Meta', 'Alt', 'Control'].includes(k)) return;
          const parts = [];
          if (ev.shiftKey) parts.push('Shift');
          if (ev.ctrlKey) parts.push('Ctrl');
          if (ev.altKey) parts.push('Alt');
          if (ev.metaKey) parts.push('Cmd');
          parts.push(k.length === 1 ? k.toUpperCase() : k);
          cleanup();
          ctx.setPref(row.key, parts.join('+'));
        };
        const cleanup = () => {
          window.removeEventListener('keydown', onKey, true);
          badge.classList.remove('is-recording');
        };
        window.addEventListener('keydown', onKey, true);
      });

      wrap.appendChild(badge);
      if (value) {
        const clear = el('button', 'keybind-clear');
        clear.innerHTML = iconSvg('xmark');
        clear.title = 'Effacer';
        clear.addEventListener('click', () => ctx.setPref(row.key, ''));
        wrap.appendChild(clear);
      }
      return rowShell(row, ctx, wrap);
    },

    // ---- Liste de cases a cocher (calendriers / rappels)
    checklist(row, ctx) {
      const r = el('div', 'row row-block');
      const disabled = ctx.getPref(row.key) || [];
      const items = (ctx.info.calendars || []).filter((c) => c.type === row.source);
      if (!items.length) {
        r.appendChild(el('div', 'row-note', 'Autorisation calendrier requise'));
        return r;
      }
      const list = el('div', 'checklist');
      for (const cal of items) {
        const item = el('label', 'check-item');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !disabled.includes(cal.id);
        cb.addEventListener('change', () => {
          const set = new Set(ctx.getPref(row.key) || []);
          if (cb.checked) set.delete(cal.id); else set.add(cal.id);
          ctx.setPref(row.key, Array.from(set), { rerender: false });
        });
        item.appendChild(cb);
        const dot = el('span', 'cal-dot');
        if (cal.color) dot.style.background = cal.color;
        item.appendChild(dot);
        item.appendChild(el('span', 'check-label', cal.title));
        list.appendChild(item);
      }
      r.appendChild(list);
      return r;
    },

    // ---- Bouton d'action
    button(row, ctx) {
      const r = el('div', 'row row-button' + (row.big ? ' row-button-big' : ''));
      const b = el('button', row.big ? 'btn btn-big' : 'btn', resolve(row.label, ctx));
      b.addEventListener('click', () => row.action && row.action(ctx));
      r.appendChild(b);
      return r;
    },

    // ---- Ligne d'information (lecture seule)
    info(row, ctx) {
      const r = el('div', 'row');
      r.appendChild(el('span', 'row-label', resolve(row.label, ctx)));
      const v = el('span', 'row-value', resolve(row.value, ctx));
      if (row.live) v.setAttribute('data-live', row.live);
      r.appendChild(v);
      return r;
    },

    // ---- Agencement des controles media (5 slots + palette)
    mediaLayout(row, ctx) {
      const r = el('div', 'row row-block');
      const paletteMap = new Map(row.palette);
      const label = (id) => paletteMap.get(id) || id;

      const slotsWrap = el('div', 'ml-slots');
      const paletteWrap = el('div', 'ml-palette');

      const getArr = () => (ctx.getPref(row.key) || []).slice(0, row.slots);
      const setArr = (arr) => ctx.setPref(row.key, arr, { rerender: false });

      function refresh() {
        slotsWrap.innerHTML = '';
        paletteWrap.innerHTML = '';
        const arr = getArr();

        // Les 5 emplacements.
        for (let i = 0; i < row.slots; i++) {
          const id = arr[i];
          const slot = el('div', 'ml-slot' + (id ? ' filled' : ''));
          slot.dataset.index = i;
          if (id) {
            const chip = el('span', 'ml-chip', label(id));
            chip.draggable = true;
            chip.dataset.id = id;
            chip.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'slot:' + i));
            // Clic sur une puce placee = la retirer.
            chip.addEventListener('click', () => {
              const next = getArr();
              next.splice(i, 1);
              setArr(next);
              refresh();
            });
            slot.appendChild(chip);
          } else {
            slot.appendChild(el('span', 'ml-empty', '+'));
          }
          slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drop'); });
          slot.addEventListener('dragleave', () => slot.classList.remove('drop'));
          slot.addEventListener('drop', (e) => {
            e.preventDefault();
            slot.classList.remove('drop');
            const data = e.dataTransfer.getData('text/plain');
            const next = getArr();
            if (data.startsWith('slot:')) {
              const from = +data.slice(5);
              const moved = next.splice(from, 1)[0];
              next.splice(i, 0, moved);
            } else if (data.startsWith('pal:')) {
              const pid = data.slice(4);
              if (!next.includes(pid)) next.splice(i, 0, pid);
            }
            setArr(next.slice(0, row.slots));
            refresh();
          });
          slotsWrap.appendChild(slot);
        }

        // La palette de controles disponibles.
        for (const [id, name] of row.palette) {
          const chip = el('span', 'ml-chip pal' + (arr.includes(id) ? ' used' : ''), name);
          chip.draggable = true;
          chip.dataset.id = id;
          chip.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'pal:' + id));
          // Clic = ajoute dans le premier slot libre.
          chip.addEventListener('click', () => {
            const next = getArr();
            if (next.includes(id) || next.length >= row.slots) return;
            next.push(id);
            setArr(next);
            refresh();
          });
          paletteWrap.appendChild(chip);
        }
      }
      refresh();

      r.appendChild(el('div', 'ml-caption', 'Layout Preview'));
      r.appendChild(slotsWrap);
      r.appendChild(el('div', 'ml-caption', 'Controles'));
      r.appendChild(paletteWrap);
      const reset = el('button', 'link-btn', 'Reset to Defaults');
      reset.addEventListener('click', () => { setArr((row.defaults || []).slice()); refresh(); });
      r.appendChild(reset);
      return r;
    },

    // ---- Couleur d'accent (segmented + apercu + selecteur)
    colorAccent(row, ctx) {
      const r = el('div', 'row row-block');
      const mode = ctx.getPref(row.modeKey);
      const color = ctx.getPref(row.colorKey);

      const seg = el('div', 'segmented');
      for (const [value, label] of [['system', 'System'], ['custom', 'Custom']]) {
        const b = el('button', 'seg-item', label);
        if (value === mode) b.classList.add('is-on');
        b.addEventListener('click', () => ctx.setPref(row.modeKey, value));
        seg.appendChild(b);
      }
      r.appendChild(seg);

      const sub = el('div', 'accent-sub');
      const dot = el('span', 'accent-dot');
      dot.style.background = color;
      sub.appendChild(dot);
      const txt = el('div', 'accent-text');
      if (mode === 'system') {
        txt.appendChild(el('div', 'row-label', 'Using System Accent'));
        txt.appendChild(el('div', 'row-desc', 'Your macOS system accent color'));
      } else {
        txt.appendChild(el('div', 'row-label', 'Couleur personnalisee'));
        txt.appendChild(el('div', 'row-desc', color));
      }
      sub.appendChild(txt);

      if (mode === 'custom') {
        const picker = el('input');
        picker.type = 'color';
        picker.className = 'color-input';
        picker.value = color;
        // input : apercu live sans re-rendu ; change : persistance definitive.
        picker.addEventListener('input', () => { dot.style.background = picker.value; });
        picker.addEventListener('change', () => ctx.setPref(row.colorKey, picker.value));
        sub.appendChild(picker);
      }
      r.appendChild(sub);
      return r;
    },

    // ---- Apercu icone d'application (statique)
    appIcon(row, ctx) {
      const r = el('div', 'row');
      const left = el('div', 'appicon-preview');
      const right = el('span', 'row-label', resolve(row.label, ctx));
      r.appendChild(left);
      r.appendChild(right);
      return r;
    },

    // ---- Boite vide avec pied +/- (placeholder)
    placeholderBox(row, ctx) {
      const r = el('div', 'row row-block');
      const box = el('div', 'placeholder-box', resolve(row.label, ctx));
      r.appendChild(box);
      if (row.footerButtons) {
        const foot = el('div', 'placeholder-foot');
        for (const b of row.footerButtons) foot.appendChild(el('button', 'ph-btn', b));
        r.appendChild(foot);
      }
      return r;
    },
  };

  function renderRow(row, ctx) {
    const fn = renderers[row.type];
    if (!fn) return el('div', 'row', '[type inconnu: ' + row.type + ']');
    return fn(row, ctx);
  }

  window.SettingsComponents = { renderRow, iconSvg, resolve };
})();
