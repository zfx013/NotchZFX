// NotchDrop — renderer. Reproduction fidele de Boring Notch :
// - NotchShape : path aux courbes quadratiques, coins hauts evases (concaves), bas convexes.
// - Springs SwiftUI : ouverture spring(response .42, damping .8), fermeture (.45, 1.0).
// - Contenu : transition scale(0.8, anchor top) + opacity, smooth 0.35s.
// - Survol 0.3s -> ouverture ; clic -> ouverture immediate ; drag de fichier -> onglet shelf.
// - Shelf local (les fichiers restent), multi-selection, AirDrop + envoi au PC pair.

const $ = (id) => document.getElementById(id);
const notchEl = $('notch');
const wrapEl = $('shadow-wrap');
const openView = $('open-view');

// ---- Geometrie (matters.swift) ----
const OPEN_DIMS = { w: 640, h: 190, tr: 19, br: 24 };
let closedDims = { w: 193, h: 32, tr: 6, br: 14 };
let physicalW = 189;
let simulated = false; // encoche externe (ecran sans vraie encoche)
let prefs = { removeOnDragOut: false, externalAnimate: true };
// Anime-t-on l'encoche ? Toujours pour l'interne ; pour l'externe selon la preference.
const animated = () => !simulated || prefs.externalAnimate;
function applyAnimClass() {
  document.documentElement.classList.toggle('simulated', simulated);
  document.documentElement.classList.toggle('no-anim', simulated && !prefs.externalAnimate);
}

let state = 'closed';
let currentView = 'home';
let items = []; // { path, name, dir: 'in'|'local' }
let peer = null;
let hoverTimer = null;
let hideTimer = null;
let dragDepth = 0;
let releaseTimer = null;

// ---- NotchShape : path fidele (NotchShape.swift:36-119) ----
function notchPath(w, h, tr, br) {
  const r = (n) => Math.round(n * 100) / 100;
  w = r(w); h = r(h); tr = r(Math.min(tr, w / 2, h)); br = r(Math.min(br, w / 2 - tr, h - tr));
  return `path('M 0 0 Q ${tr} 0 ${tr} ${tr} L ${tr} ${r(h - br)} Q ${tr} ${h} ${r(tr + br)} ${h} ` +
         `L ${r(w - tr - br)} ${h} Q ${r(w - tr)} ${h} ${r(w - tr)} ${r(h - br)} ` +
         `L ${r(w - tr)} ${tr} Q ${r(w - tr)} 0 ${w} 0 Z')`;
}

// ---- Spring SwiftUI : x'' = -w0^2 (x - cible) - 2 zeta w0 x' ----
class NotchSpring {
  constructor(init) {
    this.cur = { ...init };
    this.vel = { w: 0, h: 0, tr: 0, br: 0 };
    this.target = { ...init };
    this.omega = 10;
    this.zeta = 1;
    this.raf = null;
    this.lastT = 0;
    this.apply();
  }
  snap(target) {
    this.target = { ...target };
    this.cur = { ...target };
    for (const k in this.vel) this.vel[k] = 0;
    this.apply();
  }
  animateTo(target, response, damping) {
    this.target = { ...target };
    this.omega = (2 * Math.PI) / response;
    this.zeta = damping;
    if (!this.raf) {
      this.lastT = performance.now();
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
  }
  tick(t) {
    let dt = Math.min((t - this.lastT) / 1000, 1 / 30);
    this.lastT = t;
    for (let s = 0; s < 2; s++) {
      const h = dt / 2;
      for (const k of ['w', 'h', 'tr', 'br']) {
        const a = -this.omega * this.omega * (this.cur[k] - this.target[k]) - 2 * this.zeta * this.omega * this.vel[k];
        this.vel[k] += a * h;
        this.cur[k] += this.vel[k] * h;
      }
    }
    this.apply();
    const done = ['w', 'h', 'tr', 'br'].every(
      (k) => Math.abs(this.cur[k] - this.target[k]) < 0.15 && Math.abs(this.vel[k]) < 2
    );
    if (done) {
      this.snap(this.target);
      this.raf = null;
    } else {
      this.raf = requestAnimationFrame((tt) => this.tick(tt));
    }
  }
  apply() {
    const { w, h, tr, br } = this.cur;
    notchEl.style.width = w + 'px';
    notchEl.style.height = h + 'px';
    notchEl.style.clipPath = notchPath(w, h, tr, br);
  }
}
const spring = new NotchSpring(closedDims);

// ---- Activite fermee (lecture) : l'encoche fermee s'ELARGIT pendant la lecture
// pour que la pochette (gauche) et le spectre (droite) se deplient de part et
// d'autre de l'encoche physique (facon Boring Notch). ----
const LIVE_EXTRA = 84;
let wasLiveClosed = false;
function liveClosed() {
  return state === 'closed' && !simulated
    && prefs.showMusicLiveActivity !== false
    && !!(media && media.available && media.playing)
    && !document.documentElement.classList.contains('hud');
}
function closedTarget() {
  return liveClosed()
    ? { w: closedDims.w + LIVE_EXTRA, h: closedDims.h, tr: closedDims.tr, br: closedDims.br }
    : closedDims;
}
function applyClosedShape(force) {
  if (state !== 'closed' || document.documentElement.classList.contains('hud')) return;
  const lc = liveClosed();
  if (!force && lc === wasLiveClosed) return; // n'anime que sur changement (evite le jitter au poll 1 s)
  wasLiveClosed = lc;
  if (animated()) spring.animateTo(closedTarget(), 0.4, 0.9);
  else spring.snap(closedTarget());
}

// ---- Etat ouvert / ferme ----
function applyState(s, tab) {
  state = s;
  document.documentElement.classList.toggle('open', s === 'open');
  clearTimeout(hoverTimer);
  if (s === 'open') {
    clearTimeout(hideTimer);
    if (tab) switchTab(tab);
    // Encoche externe : animation optionnelle (preference). Si desactivee, on fige
    // la forme (snap) -> plus de scintillement. L'ombre portee (filtre) reste coupee
    // sur l'externe car c'est le principal suspect du scintillement.
    if (animated()) spring.animateTo(OPEN_DIMS, 0.42, 0.8); // ContentView.swift:123
    else spring.snap(OPEN_DIMS);
    openView.classList.remove('hiding');
    openView.classList.add('shown');
    if (!simulated) wrapEl.classList.add('shadowed');
  } else {
    // Ferme vers la forme LIVE si de la musique joue (sinon encoche fermee normale).
    wasLiveClosed = liveClosed();
    const t = closedTarget();
    if (animated()) spring.animateTo(t, 0.45, 1.0); // ContentView.swift:124
    else spring.snap(t);
    openView.classList.add('hiding');
    openView.classList.remove('shown');
    wrapEl.classList.remove('shadowed');
    hideTimer = setTimeout(() => {
      openView.classList.remove('hiding');
      // Onglet apres fermeture (BoringViewModel.swift:212-218) : shelf si non vide
      switchTab(items.length > 0 ? 'shelf' : 'home');
    }, 360);
  }
}

window.notch.onNotchState((s) => applyState(s.state, s.tab));
window.notch.onSwitchTab((t) => switchTab(t));

window.notch.onGeometry((g) => {
  // Rayons fermes : valeurs sur mesure (encoche externe) sinon defauts 6/14.
  closedDims = { w: g.closedW, h: g.closedH, tr: g.tr != null ? g.tr : 6, br: g.br != null ? g.br : 14 };
  physicalW = g.physicalW;
  simulated = !!g.simulated;
  applyAnimClass();
  document.documentElement.style.setProperty('--header-h', Math.max(24, g.closedH) + 'px');
  document.documentElement.style.setProperty('--center-w', physicalW + 'px');
  if (state === 'closed') spring.snap(closedDims);
});

window.notch.onPrefs((p) => {
  prefs = { ...prefs, ...p };
  applyAnimClass();
  // Re-applique l'etat courant pour refleter le nouveau mode (anime / fige).
  applyState(state);
  if (typeof renderCalendar === 'function') renderCalendar();
  if (typeof applyUiPrefs === 'function') applyUiPrefs();
});

// ---- Survol / clic (handleHover, ContentView.swift:513-541) ----
notchEl.addEventListener('mouseenter', () => {
  if (state !== 'closed') return;
  wrapEl.classList.add('shadowed');
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    if (state === 'closed') window.notch.openNotch(null); // minimumHoverDuration 0.3s
  }, 300);
});
notchEl.addEventListener('mouseleave', () => {
  clearTimeout(hoverTimer);
  if (state === 'closed') wrapEl.classList.remove('shadowed');
});
notchEl.addEventListener('click', (e) => {
  if (state === 'closed' && !e.defaultPrevented) window.notch.openNotch(null);
});
notchEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (state === 'closed') window.notch.popupGearMenu();
});

// ---- Onglets ----
const TAB_DEFS = [
  { key: 'home', icon: 'house.fill' },
  { key: 'shelf', icon: 'tray.fill' },
];
const tabsEl = $('tabs');
TAB_DEFS.forEach((t) => {
  const btn = document.createElement('button');
  btn.className = 'tab' + (t.key === currentView ? ' active' : '');
  btn.dataset.tab = t.key;
  btn.appendChild(icon(t.icon));
  btn.addEventListener('click', () => switchTab(t.key));
  tabsEl.appendChild(btn);
});
function switchTab(view) {
  currentView = view;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === view));
  $('view-home').hidden = view !== 'home';
  $('view-shelf').hidden = view !== 'shelf';
}
switchTab('home');

// ---- Header droite : engrenage + batterie ----
$('gear-btn').appendChild(icon('gear'));
$('gear-btn').addEventListener('click', () => window.notch.openSettings());
$('gear-btn').addEventListener('contextmenu', (e) => { e.preventDefault(); window.notch.popupGearMenu(); });

let battObj = null;
function renderBattery() {
  const show = prefs.showBatteryIndicator !== false && !!battObj;
  $('battery').hidden = !show;
  if (!show) return;
  const pct = Math.round(battObj.level * 100);
  $('battery-pct').style.display = prefs.showBatteryPercent === false ? 'none' : '';
  $('battery-pct').textContent = pct + '%';
  const fill = $('batt-fill');
  fill.style.width = pct + '%';
  fill.className = 'batt-fill ' + (battObj.charging || pct === 100 ? 'green' : pct <= 20 ? 'red' : '');
  $('batt-bolt').hidden = !battObj.charging || prefs.showChargingIcons === false;
}
if (navigator.getBattery) {
  navigator.getBattery().then((batt) => {
    battObj = batt;
    ['levelchange', 'chargingchange'].forEach((ev) => batt.addEventListener(ev, renderBattery));
    renderBattery();
  }).catch(() => {});
}
$('batt-bolt').appendChild(icon('bolt'));

// Applique les preferences d'UI cote encoche (batterie, engrenage, onglets).
function applyUiPrefs() {
  $('gear-btn').style.display = prefs.showSettingsIcon === false ? 'none' : '';
  renderBattery();
}

// ---- Vue Home : lecteur musique reel (now playing via AppleScript cote main) ----
$('album-art').insertBefore(icon('music.note'), $('home-art')); // icone de repli (pas de lecture)
const playBtn = document.createElement('button');
let media = { available: false, playing: false, positionMs: 0, durationMs: 0 };

const mkBtn = (ic, large) => {
  const btn = document.createElement('button');
  btn.className = 'hover-btn' + (large ? ' large' : '');
  btn.appendChild(icon(ic));
  return btn;
};
const prevBtn = mkBtn('backward.fill', false);
playBtn.className = 'hover-btn large';
playBtn.appendChild(icon('play.fill'));
const nextBtn = mkBtn('forward.fill', false);
prevBtn.addEventListener('click', () => window.notch.mediaControl('previous'));
playBtn.addEventListener('click', () => window.notch.mediaControl('playpause'));
nextBtn.addEventListener('click', () => window.notch.mediaControl('next'));
$('music-buttons').append(prevBtn, playBtn, nextBtn);

// Barre de progression cliquable (seek)
const sliderTrack = $('slider-track');
sliderTrack.addEventListener('click', (e) => {
  if (!media.available || !media.durationMs) return;
  const r = sliderTrack.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  window.notch.mediaSeek((media.durationMs * frac) / 1000);
});

const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function setPlayIcon(playing) {
  playBtn.replaceChildren(icon(playing ? 'pause.fill' : 'play.fill'));
}

function renderMedia(m) {
  media = m || { available: false, playing: false, positionMs: 0, durationMs: 0 };
  const playing = !!(media.available && media.playing);
  document.documentElement.classList.toggle('playing', playing);
  document.documentElement.classList.toggle('no-live', prefs.showMusicLiveActivity === false);
  const art = $('home-art');
  const liveArt = $('live-art');
  if (media.available && media.artworkUrl) {
    if (art.src !== media.artworkUrl) art.src = media.artworkUrl;
    if (liveArt.src !== media.artworkUrl) liveArt.src = media.artworkUrl;
    $('album-art').classList.remove('not-playing');
  } else {
    art.removeAttribute('src'); liveArt.removeAttribute('src');
    $('album-art').classList.add('not-playing');
  }
  $('song-title').textContent = media.available ? (media.title || 'Sans titre') : 'Aucune lecture';
  $('song-artist').textContent = media.available ? (media.artist || '') : 'NotchDrop';
  setPlayIcon(playing);
  const frac = media.durationMs ? media.positionMs / media.durationMs : 0;
  $('slider-fill').style.width = Math.min(100, frac * 100) + '%';
  $('ts-cur').textContent = fmtTime(media.positionMs);
  $('ts-dur').textContent = fmtTime(media.durationMs);
  // Spectre teinte a la couleur de la pochette (fallback blanc).
  document.documentElement.style.setProperty('--spectrum-color', media.artColor || '#ffffff');
  applyClosedShape(); // deplie / replie l'encoche fermee selon l'etat de lecture
}
window.notch.onMedia(renderMedia);

// ---- HUD volume / luminosite (etat ferme transitoire) ----
const HUD_DIMS = { w: 250, h: 62, tr: 12, br: 22 };
window.notch.onHud((h) => {
  if (simulated) return; // pas de HUD sur l'encoche externe fine
  if (h && h.visible) {
    document.documentElement.classList.add('hud');
    const ic = h.kind === 'brightness' ? 'sun.max' : (h.muted ? 'speaker.slash' : 'speaker.wave');
    $('hud-icon').replaceChildren(icon(ic));
    const pct = Math.round((h.value || 0) * 100);
    $('hud-fill').style.width = pct + '%';
    $('hud-pct').textContent = pct + '%';
    // Largeur du HUD = largeur TOTALE de l'encoche en lecture (encoche + les deux
    // extensions pochette/spectre), pour que la jauge occupe toute cette largeur.
    if (state === 'closed') spring.animateTo({ w: closedDims.w + LIVE_EXTRA, h: HUD_DIMS.h, tr: HUD_DIMS.tr, br: HUD_DIMS.br }, 0.3, 0.9);
  } else {
    document.documentElement.classList.remove('hud');
    if (state === 'closed') { wasLiveClosed = false; applyClosedShape(true); } // revient a la forme fermee (live si musique)
  }
});

// ---- Calendrier (colonne droite de la vue Home) ----
let lastCal = null;
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const hm = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

function renderCalendar(c) {
  if (c) lastCal = c;
  const cal = $('home-calendar');
  if (prefs.showCalendar === false || !lastCal || !lastCal.authorized) { cal.hidden = true; return; }
  const now = new Date();
  $('cal-header').innerHTML = `Aujourd'hui <span class="cal-sub">${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}</span>`;
  const disabled = new Set(prefs.calendarsDisabled || []);
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  let events = (lastCal.events || [])
    .filter((e) => !disabled.has(e.calendarId))
    .filter((e) => !(prefs.hideAllDayEvents && e.allDay))
    .filter((e) => new Date(e.start) <= endOfDay && new Date(e.end || e.start) >= startOfDay)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const list = $('cal-list');
  list.innerHTML = '';
  if (!events.length) {
    const div = document.createElement('div');
    div.className = 'cal-empty';
    div.textContent = "Aucun evenement aujourd'hui";
    list.appendChild(div);
  } else {
    events.slice(0, 8).forEach((e) => {
      const row = document.createElement('div');
      row.className = 'cal-event';
      const dot = document.createElement('div');
      dot.className = 'cal-dot';
      if (e.color) dot.style.background = e.color;
      const body = document.createElement('div');
      body.className = 'cal-ev-body';
      const title = document.createElement('div');
      title.className = 'cal-ev-title';
      if (prefs.showFullEventTitles) title.style.whiteSpace = 'normal';
      title.textContent = e.title || '(sans titre)';
      const time = document.createElement('div');
      time.className = 'cal-ev-time';
      time.textContent = e.allDay ? 'Toute la journee' : `${hm(e.start)}${e.end ? ' – ' + hm(e.end) : ''}`;
      body.append(title, time);
      row.append(dot, body);
      list.appendChild(row);
    });
  }
  cal.hidden = false;
}
window.notch.onCalendar(renderCalendar);

// ---- Vue Shelf : zone AirDrop + chip discret du pair ----
const airdropZone = $('share-airdrop');
const peerChip = $('peer-chip');
airdropZone.querySelector('.share-circle').appendChild(icon('airdrop'));
document.querySelector('#shelf-empty .empty-icon').appendChild(icon('tray.and.arrow.down'));
$('clear-shelf').appendChild(icon('xmark'));
if (window.notch.platform === 'darwin') airdropZone.hidden = false;

// ---- Shelf : etat + selection multiple ----
const rowEl = $('shelf-row');
let selected = new Set();
let anchorPath = null;
const cardByPath = new Map(); // path -> element (pour la selection au lasso)

function renderShelf() {
  rowEl.innerHTML = '';
  cardByPath.clear();
  $('shelf-empty').style.display = items.length ? 'none' : 'flex';
  $('clear-shelf').hidden = items.length === 0;
  items.forEach((it) => {
    const card = document.createElement('div');
    card.className = 'shelf-item' + (selected.has(it.path) ? ' selected' : '');
    card.draggable = true;
    cardByPath.set(it.path, card);

    const ph = document.createElement('div');
    ph.className = 'thumb placeholder';
    ph.textContent = (it.name.split('.').pop() || '?').slice(0, 4);
    card.appendChild(ph);
    window.notch.getThumb(it.path).then((url) => {
      if (!url || !card.contains(ph)) return;
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = url;
      img.draggable = false;
      card.replaceChild(img, ph);
    });

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = middleTruncate(it.name, 28);
    name.title = it.name;
    card.appendChild(name);

    // Selection : clic simple / Cmd+clic toggle / Shift+clic plage (ShelfSelectionModel)
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey) {
        if (selected.has(it.path)) selected.delete(it.path);
        else selected.add(it.path);
        anchorPath = it.path;
      } else if (e.shiftKey && anchorPath) {
        const a = items.findIndex((x) => x.path === anchorPath);
        const b = items.findIndex((x) => x.path === it.path);
        if (a >= 0 && b >= 0) {
          selected = new Set(items.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.path));
        }
      } else {
        selected = new Set([it.path]);
        anchorPath = it.path;
      }
      renderShelf();
    });

    card.addEventListener('dblclick', () => window.notch.openFile(it.path));

    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selected.has(it.path)) {
        selected = new Set([it.path]);
        anchorPath = it.path;
        renderShelf();
      }
      window.notch.popupItemMenu({ paths: effectiveSelection(it.path) });
    });

    // Drag sortant : si l'item fait partie de la selection, on glisse tout le lot.
    // Si la preference "retirer a l'extraction" est active, on l'enleve de l'etagere
    // (le drag natif a deja capture les chemins cote main -> la copie aboutit quand meme).
    card.addEventListener('dragstart', (e) => {
      e.preventDefault();
      const paths = effectiveSelection(it.path);
      window.notch.startDrag(paths);
      if (prefs.removeOnDragOut) setTimeout(() => removeItems(paths), 60);
    });

    rowEl.appendChild(card);
  });
}

function effectiveSelection(clickedPath) {
  return selected.has(clickedPath) && selected.size > 1 ? [...selected] : [clickedPath];
}

const panel = $('shelf-panel');
let suppressPanelClick = false;
panel.addEventListener('click', () => {
  if (suppressPanelClick) { suppressPanelClick = false; return; }
  selected.clear();
  renderShelf();
});
panel.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.notch.popupPanelMenu();
});

// ---- Selection au lasso (zone vide) + auto-scroll ----
// Le rectangle est ancre en coordonnees de CONTENU (defilement inclus) : reculer
// desELECTIONNE reellement, et le defilement etend la selection sans "coller".
const scrollEl = $('shelf-scroll');
let mqStart = null;   // marqueur "lasso actif" {x,y} viewport du depart
let mqAnchorCX = 0;   // x d'ancrage en coordonnees de contenu
let mqStartY = 0;     // y d'ancrage (viewport ; pas de defilement vertical)
let mqLast = { x: 0, y: 0 }; // derniere position curseur (viewport)
let mqEl = null;      // element visuel du rectangle
let mqBase = null;    // selection de depart (Cmd/Shift additif) — jamais cumulee
let mqMoved = false;
let mqRAF = null;     // boucle d'auto-scroll

const toContentX = (clientX, sr) => clientX - sr.left + scrollEl.scrollLeft;

function applyMarquee() {
  const sr = scrollEl.getBoundingClientRect();
  const sl = scrollEl.scrollLeft;
  const curCX = toContentX(mqLast.x, sr);
  const cx1 = Math.min(mqAnchorCX, curCX), cx2 = Math.max(mqAnchorCX, curCX);
  const vy1 = Math.min(mqStartY, mqLast.y), vy2 = Math.max(mqStartY, mqLast.y);
  if (mqEl) {
    const vx1 = cx1 - sl + sr.left, vx2 = cx2 - sl + sr.left; // contenu -> viewport
    mqEl.style.left = vx1 + 'px'; mqEl.style.top = vy1 + 'px';
    mqEl.style.width = Math.max(0, vx2 - vx1) + 'px'; mqEl.style.height = Math.max(0, vy2 - vy1) + 'px';
  }
  selected = new Set(mqBase);
  cardByPath.forEach((card, p) => {
    const r = card.getBoundingClientRect();
    const cCX1 = r.left - sr.left + sl, cCX2 = r.right - sr.left + sl;
    const hit = !(cCX2 < cx1 || cCX1 > cx2 || r.bottom < vy1 || r.top > vy2);
    card.classList.toggle('selected', hit || mqBase.has(p));
    if (hit) selected.add(p);
  });
}

// Defile tant que le curseur reste pres d'un bord (prolonge la selection).
function marqueeAutoScroll() {
  if (!mqStart || !mqMoved) { mqRAF = null; return; }
  const sr = scrollEl.getBoundingClientRect();
  const edge = 40;
  let dx = 0;
  if (mqLast.x < sr.left + edge) dx = -Math.ceil((sr.left + edge - mqLast.x) / 3);
  else if (mqLast.x > sr.right - edge) dx = Math.ceil((mqLast.x - (sr.right - edge)) / 3);
  if (dx !== 0 && scrollEl.scrollWidth > scrollEl.clientWidth) {
    const before = scrollEl.scrollLeft;
    scrollEl.scrollLeft += dx;
    if (scrollEl.scrollLeft !== before) applyMarquee();
  }
  mqRAF = requestAnimationFrame(marqueeAutoScroll);
}

panel.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;                         // clic gauche seulement
  if (e.target.closest('.shelf-item') || e.target.closest('#clear-shelf')) return; // pas sur une carte
  const sr = scrollEl.getBoundingClientRect();
  mqStart = { x: e.clientX, y: e.clientY };
  mqAnchorCX = toContentX(e.clientX, sr);
  mqStartY = e.clientY;
  mqLast = { x: e.clientX, y: e.clientY };
  mqMoved = false;
  mqBase = (e.metaKey || e.ctrlKey || e.shiftKey) ? new Set(selected) : new Set();
  e.preventDefault();                                 // evite la selection de texte
});

document.addEventListener('mousemove', (e) => {
  if (!mqStart) return;
  mqLast = { x: e.clientX, y: e.clientY };
  const dx = Math.abs(e.clientX - mqStart.x), dy = Math.abs(e.clientY - mqStart.y);
  if (!mqMoved && dx < 4 && dy < 4) return;           // seuil anti-jitter
  if (!mqMoved) {
    mqMoved = true;
    mqEl = document.createElement('div');
    mqEl.className = 'marquee';
    document.body.appendChild(mqEl);
    window.notch.setPreventClose(true);               // ne pas fermer pendant la selection
    if (!mqRAF) mqRAF = requestAnimationFrame(marqueeAutoScroll);
  }
  applyMarquee();
});

document.addEventListener('mouseup', () => {
  if (!mqStart) return;
  if (mqMoved) {
    suppressPanelClick = true;                        // ne pas vider la selection au clic suivant
    if (selected.size) anchorPath = [...selected][selected.size - 1];
    window.notch.setPreventClose(false);
  }
  if (mqEl) { mqEl.remove(); mqEl = null; }
  if (mqRAF) { cancelAnimationFrame(mqRAF); mqRAF = null; }
  mqStart = null; mqBase = null; mqMoved = false;
});
$('clear-shelf').addEventListener('click', (e) => {
  e.stopPropagation();
  clearShelf();
});

function clearShelf() {
  items = [];
  selected.clear();
  persist();
  renderShelf();
}

function persist() {
  window.notch.saveShelf(items.map(({ path, name, dir }) => ({ path, name, dir })));
}

function addItems(paths, dir) {
  const known = new Set(items.map((i) => i.path));
  paths.filter((p) => !known.has(p)).forEach((p) => {
    items.push({ path: p, name: p.split(/[\\/]/).pop(), dir });
  });
  persist();
  renderShelf();
}

function removeItems(paths) {
  const drop = new Set(paths);
  if (!drop.size) return;
  items = items.filter((i) => !drop.has(i.path));
  paths.forEach((p) => selected.delete(p));
  persist();
  renderShelf();
}

window.notch.onShelfItems((saved) => { items = saved || []; renderShelf(); });

// ---- Actions des menus natifs ----
window.notch.onMenuAction(({ action, paths }) => {
  const list = paths || [];
  if (action === 'open') list.forEach((p) => window.notch.openFile(p));
  else if (action === 'reveal') list.forEach((p) => window.notch.revealFile(p));
  else if (action === 'send-peer') sendToPeer(list);
  else if (action === 'airdrop') shareViaAirdrop(list);
  else if (action === 'remove') {
    const rm = new Set(list);
    items = items.filter((i) => !rm.has(i.path));
    list.forEach((p) => selected.delete(p));
    persist();
    renderShelf();
  } else if (action === 'select-all') {
    selected = new Set(items.map((i) => i.path));
    renderShelf();
  } else if (action === 'clear-shelf') clearShelf();
});

// ---- Envoi au pair / AirDrop ----
let chipResetTimer = null;
function chipFlash(text, isError) {
  const name = $('peer-chip-name');
  clearTimeout(chipResetTimer);
  peerChip.hidden = false;
  name.textContent = text;
  peerChip.classList.toggle('error', !!isError);
  chipResetTimer = setTimeout(() => {
    peerChip.classList.remove('error');
    if (peer) name.textContent = peer.host || peer.ip;
    else peerChip.hidden = true;
  }, 2500);
}

async function sendToPeer(paths) {
  if (!paths.length) return;
  const res = await window.notch.sendFiles(paths);
  if (!res || !res.ok || (res.results || []).some((r) => !r.ok)) {
    chipFlash(res && res.error ? res.error : 'Echec envoi', true);
  } else {
    chipFlash('Envoye !', false);
  }
}

function shareViaAirdrop(paths) {
  if (!paths.length) return;
  // Ouvre directement le panneau AirDrop (choix du destinataire), pas le menu complet.
  window.notch.airdrop(paths);
}

// ---- Drag & drop ----
// Fermeture retardee 500 ms apres fin de ciblage (ContentView.swift:217-242)
function holdOpenForDrag() {
  clearTimeout(releaseTimer);
  window.notch.setPreventClose(true);
}
function releaseDragHold() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => window.notch.setPreventClose(false), 500);
}
function endDrag() {
  dragDepth = 0;
  releaseDragHold();
}

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  if (dragDepth === 1) window.notch.dbg('DOM dragenter');
  holdOpenForDrag();
  if (state === 'closed') window.notch.openNotch('shelf');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) releaseDragHold();
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  window.notch.dbg('DOM drop, files=' + (e.dataTransfer.files ? e.dataTransfer.files.length : 0));
  endDrag();
  // Filet de securite : depot dans l'encoche ouverte hors zones dediees -> shelf local
  if (state === 'open' && currentView === 'shelf') {
    const paths = filesFromEvent(e);
    if (paths.length) addItems(paths, 'local');
  }
});

function filesFromEvent(e) {
  return Array.from(e.dataTransfer.files || [])
    .map((f) => window.notch.pathForFile(f))
    .filter(Boolean);
}

// Texte ou lien depose (pas de fichier) -> sauvegarde en .txt puis ajout au shelf.
async function textFromEvent(e) {
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (!text || !text.trim()) return null;
  return await window.notch.saveText(text);
}

// Panneau shelf : depot -> ajout LOCAL (les fichiers restent disponibles, PC eteint ou pas)
panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('targeted'); });
panel.addEventListener('dragleave', (e) => {
  if (!panel.contains(e.relatedTarget)) panel.classList.remove('targeted');
});
panel.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  panel.classList.remove('targeted');
  endDrag();
  const paths = filesFromEvent(e);
  if (paths.length) { addItems(paths, 'local'); return; }
  textFromEvent(e).then((p) => { if (p) addItems([p], 'local'); });
});

// Zone AirDrop : depot -> menu de partage systeme
airdropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); airdropZone.classList.add('targeted'); });
airdropZone.addEventListener('dragleave', (e) => {
  if (!airdropZone.contains(e.relatedTarget)) airdropZone.classList.remove('targeted');
});
airdropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  airdropZone.classList.remove('targeted');
  endDrag();
  const paths = filesFromEvent(e);
  if (paths.length) shareViaAirdrop(paths);
});
airdropZone.addEventListener('click', async (e) => {
  e.stopPropagation();
  const paths = await window.notch.pickFiles();
  if (paths.length) shareViaAirdrop(paths);
});

// Chip du pair : depot -> envoi direct au PC ; clic -> selecteur de fichiers
peerChip.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); peerChip.classList.add('targeted'); });
peerChip.addEventListener('dragleave', (e) => {
  if (!peerChip.contains(e.relatedTarget)) peerChip.classList.remove('targeted');
});
peerChip.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  peerChip.classList.remove('targeted');
  endDrag();
  const paths = filesFromEvent(e);
  if (paths.length) sendToPeer(paths);
});
peerChip.addEventListener('click', async (e) => {
  e.stopPropagation();
  const paths = await window.notch.pickFiles();
  if (paths.length) sendToPeer(paths);
});

// ---- Depot global capte par le demon (contourne le drop d'Electron) ----
// x,y = position du lacher en coordonnees fenetre -> on route vers la zone visee.
window.notch.onExternalDrop(({ paths, x, y }) => {
  if (!paths || !paths.length) return;
  const el = document.elementFromPoint(x, y);
  if (el && el.closest('#share-airdrop')) {
    shareViaAirdrop(paths);
  } else if (el && el.closest('#peer-chip')) {
    sendToPeer(paths);
  } else {
    // Defaut : deposer sur le shelf (les fichiers y restent, PC eteint ou non)
    addItems(paths, 'local');
    switchTab('shelf');
  }
});

// ---- Evenements reseau ----
window.notch.onFileReceived((d) => addItems([d.path], 'in'));

window.notch.onPeerUpdated((d) => {
  peer = d;
  peerChip.hidden = false;
  peerChip.classList.remove('error');
  $('peer-chip-name').textContent = d.host || d.ip;
});

window.notch.onSelfInfo(() => {});

renderShelf();

// Troncature au milieu (equivalent truncationMode .middle de SwiftUI)
function middleTruncate(s, max) {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) * 0.6);
  const tail = max - 1 - head;
  return s.slice(0, head) + '\u2026' + s.slice(-tail);
}
