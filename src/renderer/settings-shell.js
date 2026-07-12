// Coquille de la fenetre Parametres : barre laterale, navigation entre pages,
// pont vers l'API `window.settings` (prefs + infos). Sans modules ES.
//
// Depend de :
//   window.SETTINGS_PAGES        (settings-schema.js)
//   window.SettingsComponents    (settings-components.js)

(function () {
  const api = window.settings;
  const { renderRow, iconSvg, resolve } = window.SettingsComponents;

  const state = {
    prefs: {},
    info: { displays: [], calendars: [] },
    activeId: 'general',
  };

  // Contexte transmis a chaque composant.
  const ctx = {
    getPref: (k) => state.prefs[k],
    setPref: (k, v, opts) => {
      state.prefs[k] = v;
      api.setPref(k, v);
      if (!opts || opts.rerender !== false) renderContent();
    },
    rerender: () => renderContent(),
    get info() { return state.info; },
  };

  // ------------------------------------------------------------ Barre laterale
  function buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';
    for (const page of window.SETTINGS_PAGES) {
      const item = document.createElement('button');
      item.className = 'nav-item' + (page.id === state.activeId ? ' is-active' : '');
      item.dataset.id = page.id;
      const ic = document.createElement('span');
      ic.className = 'nav-icon';
      ic.innerHTML = iconSvg(page.icon);
      item.appendChild(ic);
      const lbl = document.createElement('span');
      lbl.className = 'nav-label';
      lbl.textContent = page.label;
      item.appendChild(lbl);
      item.addEventListener('click', () => {
        state.activeId = page.id;
        buildSidebar();
        renderContent();
      });
      nav.appendChild(item);
    }
  }

  // -------------------------------------------------------------- Zone contenu
  function currentPage() {
    return window.SETTINGS_PAGES.find((p) => p.id === state.activeId) || window.SETTINGS_PAGES[0];
  }

  function renderContent() {
    const page = currentPage();
    const root = document.getElementById('content');
    root.innerHTML = '';
    root.scrollTop = root.scrollTop; // conserve le defilement au re-rendu

    // En-tete de page (titre + bouton d'action optionnel).
    const head = document.createElement('div');
    head.className = 'page-head';
    const h1 = document.createElement('h1');
    h1.textContent = page.label;
    head.appendChild(h1);
    if (page.headerButton) {
      const b = document.createElement('button');
      b.className = 'head-btn';
      b.textContent = page.headerButton.label;
      b.addEventListener('click', () => page.headerButton.action(ctx));
      head.appendChild(b);
    }
    root.appendChild(head);

    // Sections en cartes.
    for (const section of page.sections) {
      const card = document.createElement('section');
      card.className = 'card';

      if (section.title || section.badge) {
        const st = document.createElement('div');
        st.className = 'section-title';
        if (section.title) st.appendChild(textSpan(section.title));
        if (section.badge) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = section.badge;
          st.appendChild(badge);
        }
        card.appendChild(st);
      }

      const body = document.createElement('div');
      body.className = 'card-body';
      for (const row of section.rows) body.appendChild(renderRow(row, ctx));
      card.appendChild(body);

      if (section.note) {
        const note = document.createElement('div');
        note.className = 'section-note';
        note.textContent = resolve(section.note, ctx);
        card.appendChild(note);
      }
      root.appendChild(card);
    }

    if (page.footer) {
      const foot = document.createElement('div');
      foot.className = 'page-footer';
      foot.textContent = page.footer;
      root.appendChild(foot);
    }
  }

  function textSpan(t) {
    const s = document.createElement('span');
    s.textContent = t;
    return s;
  }

  // -------------------------------------- Mise a jour de la liste d'appareils (live)
  function applyPeers(list) {
    const peers = Array.isArray(list) ? list : [];
    state.info.peers = peers;
    // Met a jour uniquement le champ live si la page Sync est affichee.
    const node = document.querySelector('[data-live="peer"]');
    if (node) node.textContent = peers.length ? `${peers.length} appareil${peers.length > 1 ? 's' : ''}` : 'aucun';
  }

  // ------------------------------------------------------------------ Demarrage
  async function init() {
    buildSidebar();
    try {
      const [prefs, info] = await Promise.all([api.getPrefs(), api.getInfo()]);
      state.prefs = prefs || {};
      state.info = Object.assign({ displays: [], calendars: [] }, info || {});
    } catch (err) {
      console.warn('chargement parametres echoue:', err);
    }
    renderContent();
    if (api.onPeers) api.onPeers(applyPeers);
  }

  init();
})();
