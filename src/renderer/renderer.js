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
const flashSvg = $('recv-flash');
const contourPath = $('recv-contour');
// Refs liste-appareils declarees tot : closeDeviceList() est appele des le
// switchTab('home') initial, avant le bloc liste -> evite une TDZ sur anpEl.
const anpEl = $('airnotch-pop');
const anpList = $('anp-list');
const anpSub = $('anp-sub');

// ---- Geometrie (matters.swift) ----
const OPEN_DIMS = { w: 640, h: 190, tr: 19, br: 24 };
let closedDims = { w: 193, h: 32, tr: 6, br: 14 };
let physicalW = 189;
let simulated = false; // encoche externe (ecran sans vraie encoche)
let prefs = { removeOnDragOut: false, externalAnimate: true };
const isWin = window.notch.platform === 'win32';
// Anime-t-on l'encoche ? Interne : toujours ; externe (dont Windows) : selon la
// preference externalAnimate. Ouverture ET fermeture animees (l'utilisateur veut
// retrouver l'animation d'ouverture sur Windows).
const animated = () => !simulated || prefs.externalAnimate;
const animatedClose = animated;
function applyAnimClass() {
  document.documentElement.classList.toggle('simulated', simulated);
  document.documentElement.classList.toggle('no-anim', simulated && !prefs.externalAnimate);
}

let state = 'closed';
// Windows : le media (AppleScript) et le calendrier (EventKit) sont macOS-only -> on
// n'expose QUE la bibliotheque de fichiers. La vue par defaut est donc le shelf.
let currentView = window.notch.platform === 'win32' ? 'shelf' : 'home';
let items = []; // { path, name, dir: 'in'|'local' }
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

// Contour de reception : U OUVERT epousant la silhouette (cote gauche + bas + cote
// droit), SANS l'arete du haut. Trace stroke a epaisseur constante -> bas et cotes
// identiques ; le degrade vertical (CSS/SVG) efface le violet pres du bord haut.
function notchContourPath(w, h, tr, br) {
  const r = (n) => Math.round(n * 100) / 100;
  w = r(w); h = r(h); tr = r(Math.min(tr, w / 2, h)); br = r(Math.min(br, w / 2 - tr, h - tr));
  return `M ${tr} ${tr} L ${tr} ${r(h - br)} Q ${tr} ${h} ${r(tr + br)} ${h} ` +
         `L ${r(w - tr - br)} ${h} Q ${r(w - tr)} ${h} ${r(w - tr)} ${r(h - br)} L ${r(w - tr)} ${tr}`;
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
    if (contourPath) {
      const rw = Math.round(w * 100) / 100, rh = Math.round(h * 100) / 100;
      flashSvg.setAttribute('viewBox', `0 0 ${rw} ${rh}`);
      contourPath.setAttribute('d', notchContourPath(w, h, tr, br));
    }
  }
}
const spring = new NotchSpring(closedDims);

// ---- Activite fermee (lecture) : l'encoche fermee s'ELARGIT pendant la lecture
// pour que la pochette (gauche) et le spectre (droite) se deplient de part et
// d'autre de l'encoche physique (facon Boring Notch). ----
const LIVE_EXTRA = 84;
let wasLiveClosed = false;
let notifying = false; // peek de notification en cours (fichier recu) -> fige la forme fermee
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
  if (state !== 'closed' || document.documentElement.classList.contains('hud') || notifying) return;
  const lc = liveClosed();
  if (!force && lc === wasLiveClosed) return; // n'anime que sur changement (evite le jitter au poll 1 s)
  wasLiveClosed = lc;
  if (animated()) spring.animateTo(closedTarget(), 0.4, 0.9);
  else spring.snap(closedTarget());
}

// ---- Peek de notification : l'encoche fermee GROSSIT brievement en pilule (fichier
// recu d'un autre appareil). Pilote par main (onNotchNotify) qui a deja agrandi la
// fenetre pour laisser la place. Pas d'ouverture de la vue complete. ----
function notifDims() {
  return { w: closedDims.w + 120, h: Math.max(closedDims.h + 22, 50), tr: closedDims.tr, br: 24 };
}
function notifPeek(on) {
  if (state === 'open' || document.documentElement.classList.contains('hud')) {
    // Ouvert (ou HUD affiche) : pas de peek de forme, mais on doit quand meme pouvoir
    // SORTIR de l'etat notif -> sinon `notifying` reste bloque a true et applyClosedShape
    // ne re-adapte plus jamais la forme fermee (live activity / HUD figes).
    if (!on) notifying = false;
    return;
  }
  notifying = on;
  // Aller : ressort nettement sous-amorti (zeta 0.42) + periode plus longue (0.5)
  // -> la pilule DEPASSE bien puis rebondit visiblement. Retour plus doux.
  if (on) spring.animateTo(notifDims(), 0.5, 0.42);
  else spring.animateTo(closedTarget(), 0.42, 0.9);
}

// ---- Etat ouvert / ferme ----
function applyState(s, tab) {
  state = s;
  document.documentElement.classList.toggle('open', s === 'open');
  updateKeyFocus(); // fermeture -> relache le focus clavier
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
    // Fermeture : animee aussi sur Windows (retour doux quand la souris sort).
    if (animatedClose()) spring.animateTo(t, 0.45, 1.0); // ContentView.swift:124
    else spring.snap(t);
    openView.classList.add('hiding');
    openView.classList.remove('shown');
    wrapEl.classList.remove('shadowed');
    closeDeviceList();
    hideTimer = setTimeout(() => {
      openView.classList.remove('hiding');
      // Onglet apres fermeture (BoringViewModel.swift:212-218) : shelf si non vide
      switchTab(items.length > 0 ? 'shelf' : 'home');
    }, 360);
  }
}

window.notch.onNotchState((s) => applyState(s.state, s.tab));
window.notch.onNotchNotify((d) => { const on = !!(d && d.on); notifPeek(on); if (on && state !== 'open') pulseNotch(); });
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

// Couleur d'accent : "custom" -> couleur choisie, sinon l'accent systeme (bleu). Pilote
// la surbrillance de selection (var(--accent)).
function applyAccent() {
  const c = (prefs.accentMode === 'custom' && prefs.accentColor) ? prefs.accentColor : '#0A84FF';
  document.documentElement.style.setProperty('--accent', c);
}
window.notch.onPrefs((p) => {
  prefs = { ...prefs, ...p };
  applyAnimClass();
  applyAccent();
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

// ---- Onglets ---- (Windows : seulement la bibliotheque, on masque Home + la barre)
const TAB_DEFS = (isWin ? [{ key: 'shelf', icon: 'tray.fill' }] : [
  { key: 'home', icon: 'house.fill' },
  { key: 'shelf', icon: 'tray.fill' },
]);
const tabsEl = $('tabs');
if (isWin) tabsEl.style.display = 'none'; // un seul onglet -> barre inutile
TAB_DEFS.forEach((t) => {
  const btn = document.createElement('button');
  btn.className = 'tab' + (t.key === currentView ? ' active' : '');
  btn.dataset.tab = t.key;
  btn.appendChild(icon(t.icon));
  btn.addEventListener('click', () => switchTab(t.key));
  tabsEl.appendChild(btn);
});
function switchTab(view) {
  if (isWin) view = 'shelf'; // Windows : jamais de vue Home (media/calendrier macOS-only)
  currentView = view;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === view));
  $('view-home').hidden = view !== 'home';
  $('view-shelf').hidden = view !== 'shelf';
  if (view !== 'shelf') closeDeviceList();
}
switchTab(currentView);

// ---- Header droite : engrenage + batterie ----
$('gear-btn').appendChild(icon('gear'));
$('gear-btn').addEventListener('click', () => window.notch.openSettings());
$('gear-btn').addEventListener('contextmenu', (e) => { e.preventDefault(); window.notch.popupGearMenu(); });

let battObj = null;
function renderBattery() {
  // Pas d'indicateur de batterie sur Windows (l'utilisateur n'en veut pas).
  const show = !isWin && prefs.showBatteryIndicator !== false && !!battObj;
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
// AirDrop dispo partout : Mac = natif ; PC = relais via le Mac (choix sur le Mac).
airdropZone.hidden = false;
if (window.notch.platform !== 'darwin') {
  const lbl = airdropZone.querySelector('.share-label');
  if (lbl) lbl.textContent = 'AirDrop via Mac';
}

// Liste des appareils sur le reseau (lecture seule). La pastille #peer-chip montre
// le nombre ; au survol, on affiche la liste des noms. AUCUNE selection/envoi : la
// bibliotheque est commune, tout se partage automatiquement.
let peersList = [];
function renderPeers() {
  const n = peersList.length;
  peerChip.hidden = n === 0;
  if (n > 0) $('peer-chip-name').textContent = String(n);
  if (n === 0) closeDeviceList();
  else if (anpEl && !anpEl.hidden) buildDeviceList();
}

function deviceGlyph(p) {
  if (p.form === 'laptop') return 'laptopcomputer';
  if (p.os === 'mac') return 'desktopcomputer';
  return 'pc.display';
}

// Construit la liste passive : un appareil par pair (icone + nom + point vert).
function buildDeviceList() {
  anpList.innerHTML = '';
  if (!peersList.length) {
    const e = document.createElement('div');
    e.className = 'an-empty';
    e.textContent = 'Aucun appareil sur le réseau';
    anpList.appendChild(e);
    return;
  }
  peersList.forEach((d) => {
    const t = document.createElement('div');
    t.className = 'an-tile readonly' + (d.mine ? ' mine' : '');
    const av = document.createElement('div');
    av.className = 'an-avatar';
    av.appendChild(icon(deviceGlyph(d), 'an-glyph'));
    const dot = document.createElement('span'); dot.className = 'an-dot'; av.appendChild(dot);
    const nm = document.createElement('div');
    nm.className = 'an-name';
    nm.textContent = d.name || d.host || 'Appareil';
    t.appendChild(av); t.appendChild(nm);
    anpList.appendChild(t);
  });
}

let deviceListHideTimer = null;
function openDeviceList() {
  if (!peersList.length) return;
  clearTimeout(deviceListHideTimer);
  anpSub.textContent = peersList.length + (peersList.length > 1 ? ' appareils' : ' appareil');
  buildDeviceList();
  anpEl.hidden = false;
}
function closeDeviceList() { if (anpEl) anpEl.hidden = true; }
function scheduleDeviceListHide() {
  clearTimeout(deviceListHideTimer);
  deviceListHideTimer = setTimeout(closeDeviceList, 180);
}

// Survol de la pastille -> liste ; on la garde ouverte tant que le curseur est sur
// la pastille ou sur la liste elle-meme.
peerChip.addEventListener('mouseenter', openDeviceList);
peerChip.addEventListener('mouseleave', scheduleDeviceListHide);
anpEl.addEventListener('mouseenter', () => clearTimeout(deviceListHideTimer));
anpEl.addEventListener('mouseleave', scheduleDeviceListHide);

// ---- Shelf : etat + selection multiple ----
const rowEl = $('shelf-row');
let selected = new Set();
let anchorPath = null;
const cardByPath = new Map(); // path -> element (pour la selection au lasso)

// Anneau de progression circulaire (facon App Store) : piste + arc qui se remplit.
const RING_R = 13;
const RING_C = 2 * Math.PI * RING_R;
const thumbCache = new Map(); // path -> data URL (evite de re-fetch les vignettes a chaque rendu)

// Focus clavier : on ne le demande au main QUE lorsqu'un fichier est selectionne (clic
// delibere) et l'encoche ouverte -> Espace (Quick Look) et Suppr marchent, sans voler le
// focus au simple survol.
let keyFocusOn = false;
function updateKeyFocus() {
  const want = state === 'open' && [...selected].some(Boolean);
  if (want === keyFocusOn) return;
  keyFocusOn = want;
  window.notch.notchFocus(want);
}

function makeDlRing(id, pct) {
  const wrap = document.createElement('div');
  wrap.className = 'dl-ring';
  wrap.dataset.ring = id;
  wrap.innerHTML =
    '<svg viewBox="0 0 32 32">' +
      '<circle class="dl-track" cx="16" cy="16" r="' + RING_R + '"></circle>' +
      '<circle class="dl-arc" cx="16" cy="16" r="' + RING_R + '" stroke-dasharray="' +
        RING_C.toFixed(2) + '" stroke-dashoffset="' + (RING_C * (1 - pct)).toFixed(2) + '"></circle>' +
    '</svg>';
  return wrap;
}
function updateDlRing(id, pct) {
  const arc = rowEl.querySelector('[data-ring="' + id + '"] .dl-arc');
  if (arc) arc.setAttribute('stroke-dashoffset', (RING_C * (1 - Math.max(0, Math.min(1, pct)))).toFixed(2));
}

function renderShelf() {
  rowEl.innerHTML = '';
  cardByPath.clear();
  $('shelf-empty').style.display = items.length ? 'none' : 'flex';
  $('clear-shelf').hidden = items.length === 0;
  items.forEach((it) => {
    const dl = !!it.downloading;
    const card = document.createElement('div');
    card.className = 'shelf-item' + (!dl && selected.has(it.path) ? ' selected' : '') + (it.from ? ' from-peer' : '') + (dl ? ' downloading' : '');
    card.draggable = !dl;
    if (!dl) cardByPath.set(it.path, card);

    // Fichier recu d'un autre appareil : pastille violette + info d'expediteur.
    if (it.from) {
      const badge = document.createElement('span');
      badge.className = 'from-badge';
      badge.title = 'Recu de ' + it.from.name;
      card.appendChild(badge);
    }

    const ph = document.createElement('div');
    ph.className = 'thumb placeholder';
    ph.textContent = (it.name.split('.').pop() || '?').slice(0, 4);
    card.appendChild(ph);
    if (!dl) {
      const setThumb = (url) => {
        if (!url || !card.contains(ph)) return;
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = url;
        img.draggable = false;
        card.replaceChild(img, ph);
      };
      // Cache des vignettes : evite un aller-retour IPC + un flicker gris->image sur
      // CHAQUE re-rendu (un simple clic de selection re-rendait toute l'etagere).
      const cached = thumbCache.get(it.path);
      if (cached) setThumb(cached);
      else window.notch.getThumb(it.path).then((url) => { if (url) { thumbCache.set(it.path, url); setThumb(url); } });
    } else {
      // Telechargement en cours : anneau de progression (facon App Store) par-dessus.
      card.appendChild(makeDlRing(it.id, it.pct || 0));
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = middleTruncate(it.name, 28);
    name.title = it.name;
    card.appendChild(name);

    if (dl) {
      // Placeholder en telechargement : pas d'interactions, mais on avale le clic pour
      // ne pas vider la selection en cours (le clic remonterait sinon au panel).
      card.addEventListener('click', (e) => e.stopPropagation());
      rowEl.appendChild(card);
      return;
    }

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
      window.notch.popupItemMenu({ paths: effectiveSelection(it.path), from: it.from || null });
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
  updateKeyFocus(); // la selection a pu changer -> (re)prend/relache le focus clavier
}

function effectiveSelection(clickedPath) {
  const base = selected.has(clickedPath) && selected.size > 1 ? [...selected] : [clickedPath];
  return base.filter(Boolean); // jamais de path null (placeholder en telechargement)
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
// La croix est aussi une CIBLE DE DEPOT : glisser un/des fichier(s) dessus les retire de
// la barre (et les propage aux pairs) au lieu de tout vider. Fonctionne avec le drag
// natif d'une carte (l'OS livre le fichier a la fenetre au lacher).
const clearBtn = $('clear-shelf');
clearBtn.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); clearBtn.classList.add('drop-del'); });
clearBtn.addEventListener('dragleave', (e) => { e.stopPropagation(); clearBtn.classList.remove('drop-del'); });
clearBtn.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation(); // ne PAS laisser le panel/document re-ajouter les fichiers
  clearBtn.classList.remove('drop-del');
  endDrag();
  const dropped = new Set(filesFromEvent(e));
  // On ne retire que ce qui est reellement dans la barre (un fichier externe est ignore).
  const toRemove = items.filter((i) => i.path && dropped.has(i.path)).map((i) => i.path);
  if (toRemove.length) removeItems(toRemove);
});

function clearShelf() {
  items = [];
  selected.clear();
  renderShelf();
  // Bibliotheque commune : vide localement (persist) ET sur tous les appareils du reseau.
  window.notch.clearLibrary();
}

function persist() {
  // Les placeholders en cours de telechargement (path null) ne sont pas persistes.
  window.notch.saveShelf(
    items.filter((i) => i.path && !i.downloading)
      .map(({ path, name, dir, from, receivedAt, id }) => ({ path, name, dir, from, receivedAt, id }))
  );
}

// Id local unique : sert d'id PARTAGE (les pairs referencent le meme item) -> permet de
// propager la suppression d'un fichier unitaire.
function genId() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function addItems(paths, dir, from) {
  const known = new Set(items.map((i) => i.path));
  const now = Date.now();
  const added = [];
  paths.filter((p) => !known.has(p)).forEach((p) => {
    const it = { path: p, name: p.split(/[\\/]/).pop(), dir, from: from || null, receivedAt: from ? now : undefined, id: genId() };
    items.push(it);
    added.push(it);
  });
  persist();
  renderShelf();
  return added;
}

// Ajout LOCAL a la bibliotheque commune : on garde le fichier ici ET on le copie
// automatiquement vers tous les appareils du reseau (aucune selection).
async function addLocal(paths) {
  if (!paths || !paths.length) return;
  const added = addItems(paths, 'local');
  if (!added.length) return; // deja dans la bibliotheque
  // On envoie {path, id} : les pairs stockent l'item sous le MEME id (suppression propageable).
  const entries = added.map((it) => ({ path: it.path, id: it.id }));
  const res = await window.notch.shareToAll(entries);
  if (!res) return;
  if (res.ok) chipFlash('Partagé ✓', false);            // "Partagé ✓"
  else if (res.error === 'no-paired') chipFlash('Aucun appareil appairé', true);
  else if (res.error === 'aucun appareil') { /* seul sur le reseau : on reste silencieux */ }
  else chipFlash('Partage échoué', true);
}

// Effet visuel discret (sans texte) quand un fichier arrive d'un autre appareil :
// une pulsation violette qui suit la forme de l'encoche.
let pulseTimer = null;
function pulseNotch() {
  const n = document.getElementById('notch');
  if (!n) return;
  clearTimeout(pulseTimer); // receptions rapprochees : on relance proprement
  n.classList.remove('recv-pulse');
  void n.offsetWidth; // force un reflow -> relance l'animation meme si rapprochee
  n.classList.add('recv-pulse');
  // 1300 ms = duree reelle de @keyframes recvFlash (retirer avant faisait retomber le
  // contour violet a sec ~73% -> pop visible).
  pulseTimer = setTimeout(() => n.classList.remove('recv-pulse'), 1300);
}

function removeItems(paths) {
  const drop = new Set(paths);
  if (!drop.size) return;
  // Ids partages des items retires -> on propage la suppression aux pairs (cohérence
  // de la bibliotheque commune : supprimer un fichier le retire partout).
  const ids = items.filter((i) => drop.has(i.path) && i.id).map((i) => i.id);
  items = items.filter((i) => !drop.has(i.path));
  paths.forEach((p) => selected.delete(p));
  persist();
  renderShelf();
  if (ids.length) window.notch.removeShared(ids);
}

// Clavier (encoche ouverte) : Suppr/Retour arriere retire la selection, Echap la vide,
// Espace ouvre la previsualisation Quick Look (macOS) du/des fichier(s) selectionne(s).
document.addEventListener('keydown', (e) => {
  if (state !== 'open') return;
  if (e.key === 'Escape') { if (selected.size) { selected.clear(); renderShelf(); } return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const paths = [...selected].filter(Boolean);
    if (paths.length) { e.preventDefault(); removeItems(paths); }
    return;
  }
  if (e.key === ' ' || e.code === 'Space') {
    const sel = [...selected].filter(Boolean);
    if (!sel.length) return;
    e.preventDefault();
    let qlPaths;
    if (sel.length > 1) {
      qlPaths = sel; // plusieurs selectionnes -> on navigue entre eux aux fleches
    } else {
      // un seul selectionne -> previsualise TOUTE la bibliotheque en commencant par lui
      // (fleches = naviguer dans tous les fichiers, comme le Finder).
      const all = items.filter((i) => i.path).map((i) => i.path);
      const idx = all.indexOf(sel[0]);
      qlPaths = idx >= 0 ? all.slice(idx).concat(all.slice(0, idx)) : sel;
    }
    window.notch.quickLook(qlPaths);
  }
});

// Suppression RECUE d'un pair (par id partage) : on retire localement sans re-propager.
window.notch.onShelfRemove((ids) => {
  if (!Array.isArray(ids) || !ids.length) return;
  const rm = new Set(ids);
  const before = items.length;
  items = items.filter((i) => !(i.id && rm.has(i.id)));
  if (items.length === before) return;
  const present = new Set(items.map((i) => i.path));
  [...selected].forEach((p) => { if (!present.has(p)) selected.delete(p); });
  persist();
  renderShelf();
});

window.notch.onShelfItems((saved) => {
  // On preserve les placeholders en cours de telechargement (absents du disque).
  const dl = items.filter((i) => i.downloading);
  const list = saved || [];
  items = list.concat(dl.filter((d) => !list.some((s) => s.id && s.id === d.id)));
  // Reconcilie la selection : un fichier retire par un autre appareil ne doit pas rester
  // dans `selected` (fantome transmis au main via effectiveSelection/select-all).
  const present = new Set(items.map((i) => i.path));
  [...selected].forEach((p) => { if (!present.has(p)) selected.delete(p); });
  renderShelf();
});

// ---- Actions des menus natifs ----
window.notch.onMenuAction(({ action, paths }) => {
  const list = paths || [];
  if (action === 'open') list.forEach((p) => window.notch.openFile(p));
  else if (action === 'reveal') list.forEach((p) => window.notch.revealFile(p));
  else if (action === 'send-peer') sendToPeer(list);
  else if (action === 'airdrop') shareViaAirdrop(list);
  else if (action === 'remove') {
    removeItems(list); // retire + propage aux pairs
  } else if (action === 'select-all') {
    selected = new Set(items.filter((i) => i.path && !i.downloading).map((i) => i.path));
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
    if (peersList.length) name.textContent = String(peersList.length);
    else peerChip.hidden = true;
  }, 2500);
}

// Envoi par defaut (glisser sur le shelf/chip) : tous les appareils, ou l'appareil
// choisi dans les reglages (defaultSend = all | one). Gere cote main.
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
  if (window.notch.platform === 'darwin') {
    // Mac : ouvre directement le panneau AirDrop natif (choix du destinataire).
    window.notch.airdrop(paths);
  } else {
    // PC : AirDrop impossible nativement -> on relaie au Mac, qui ouvrira son panneau
    // AirDrop avec le fichier (le choix du destinataire se fait sur le Mac).
    window.notch.airdropViaPeer(paths);
  }
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
  // Filet de securite : depot dans l'encoche ouverte hors zones dediees -> bibliotheque
  // commune (garde ici + copie a tous les appareils du reseau).
  if (state === 'open' && currentView === 'shelf') {
    const paths = filesFromEvent(e);
    if (paths.length) addLocal(paths);
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

// Panneau shelf : depot -> bibliotheque commune (garde ici + copie a tous)
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
  if (paths.length) { addLocal(paths); return; }
  textFromEvent(e).then((p) => { if (p) addLocal([p]); });
});

// Zone AirDrop : depot -> partage (Mac natif ou relais via le Mac)
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

// Pastille appareils : depot dessus = bibliotheque commune (comme partout ailleurs).
// (La liste au survol est en lecture seule ; aucun clic d'envoi.)
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
  if (paths.length) addLocal(paths);
});

// ---- Depot global capte par le demon (contourne le drop d'Electron) ----
// x,y = position du lacher en coordonnees fenetre -> on route vers la zone visee.
window.notch.onExternalDrop(({ paths, x, y }) => {
  if (!paths || !paths.length) return;
  const el = document.elementFromPoint(x, y);
  if (el && el.closest('#share-airdrop')) {
    shareViaAirdrop(paths); // AirDrop = envoi ponctuel vers un appareil Apple hors app
  } else {
    // Partout ailleurs -> bibliotheque commune (garde ici + copie a tous les appareils).
    addLocal(paths);
    switchTab('shelf');
  }
});

// ---- Evenements reseau : transfert avec anneau de progression ----
// Debut : le fichier apparait TOUT DE SUITE en placeholder + anneau (avant la fin).
window.notch.onFileIncoming((d) => {
  if (!d || !d.id || items.some((i) => i.id === d.id)) return;
  items.push({ id: d.id, path: null, name: d.name || 'fichier', dir: 'in', from: d.from || null,
    downloading: true, pct: 0, size: d.size || 0, receivedAt: Date.now() });
  renderShelf(); // pas de persist (placeholder transitoire, pas de fichier sur disque)
});
// Progression : on met a jour l'anneau du placeholder (sans re-rendre toute l'etagere).
window.notch.onFileProgress((d) => {
  if (!d || !d.id) return;
  const idx = items.findIndex((i) => i.id === d.id && i.downloading);
  if (idx < 0) return;
  if (d.failed) {
    // Transfert interrompu (pair deconnecte, erreur reseau) : on RETIRE le placeholder
    // coince (sinon anneau fige a vie, carte inerte, seul "Vider" le supprimait).
    const nm = items[idx].name;
    items.splice(idx, 1);
    renderShelf();
    chipFlash('Transfert interrompu' + (nm ? ' : ' + middleTruncate(nm, 16) : ''), true);
    return;
  }
  const it = items[idx];
  if (d.size) it.pct = Math.min(1, d.received / d.size);
  updateDlRing(d.id, it.pct);
});
// Fin : on finalise le placeholder (chemin reel + vignette) ; sinon ajout classique.
window.notch.onFileReceived((d) => {
  if (d.id) {
    const it = items.find((i) => i.id === d.id);
    if (it) {
      it.path = d.path; it.name = d.name || it.name; it.from = d.from || it.from;
      it.downloading = false; it.pct = 1;
      persist();
      renderShelf();
      return;
    }
  }
  const added = addItems([d.path], 'in', d.from);
  if (added[0] && d.id) { added[0].id = d.id; persist(); } // conserve l'id partage
});

window.notch.onPeers((list) => { peersList = Array.isArray(list) ? list : []; renderPeers(); });

window.notch.onSelfInfo(() => {});

renderPeers();
renderShelf();

// Troncature au milieu (equivalent truncationMode .middle de SwiftUI)
function middleTruncate(s, max) {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) * 0.6);
  const tail = max - 1 - head;
  return s.slice(0, head) + '\u2026' + s.slice(-tail);
}
