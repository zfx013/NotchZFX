// NotchDrop Sync — process principal.
// Architecture calquee sur Boring Notch (boringNotchApp.swift + ContentView.swift) :
// - Fenetre FIXE 640x210 (openNotchSize 640x190 + shadowPadding 20), transparente,
//   collee en haut-centre par-dessus la barre des menus. Elle ne bouge JAMAIS :
//   seule la forme noire dessinee par le renderer change de taille.
// - Etat ferme : click-through, sauf quand le curseur est sur la zone de l'encoche.
// - Fermeture 100 ms apres sortie de la souris (ContentView.swift:542-557).
// - Ouverture auto sur drag de fichier -> onglet shelf (DragDetector).
const { app, BrowserWindow, ipcMain, screen, shell, nativeImage, Tray, Menu, ShareMenu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const net = require('./network');
const { baseGeometry, probeMacNotch } = require('./geometry');
const { ShelfStore } = require('./shelfStore');
const { PrefsStore } = require('./prefsStore');
const { startDragMonitor } = require('./dragDaemon');
const mediaLib = require('./media');
const { getCalendar, buildCalendarHelper } = require('./calendarDaemon');
const { startHudMonitor } = require('./hudDaemon');
const { startMediaKeys } = require('./mediaKeyDaemon');
const { applyStationary } = require('./macWindow');

// Dossier userData FIXE "NotchZFX" (+ migration depuis les anciens noms) : le nom
// du bundle peut changer sans perdre l'etagere ni les preferences.
try {
  const appData = app.getPath('appData');
  const target = path.join(appData, 'NotchZFX');
  if (!fs.existsSync(target)) {
    for (const old of ['notchdrop-sync', 'notchzfx']) {
      const oldDir = path.join(appData, old);
      if (fs.existsSync(oldDir)) { fs.renameSync(oldDir, target); break; }
    }
  }
  app.setPath('userData', target);
} catch (_) {}

// Une seule instance a la fois (evite les conflits de ports 8787/8788).
if (!app.requestSingleInstanceLock()) app.quit();

// Icone du drag natif et du tray (carre arrondi noir 16x16, PNG valide).
const ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVR4nGNgwAT/CWCcgJBGvAaRqhnDEIoMIFcz3JBRA4aFAZQYwkA1A8gxBCcgSSMACNzfIaAiIvMAAAAASUVORK5CYII=';
const iconImage = nativeImage.createFromBuffer(Buffer.from(ICON_B64, 'base64'));
if (process.platform === 'darwin') iconImage.setTemplateImage(true);

// Icone de la barre de menus (silhouette d'encoche + goutte) : PNG 44x44 en @2x
// -> rendu net ~22pt. Image "template" (s'adapte clair/sombre).
const TRAY_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAABs0lEQVR4nOyWzysEYRjHv5YiRbGXvQjlR3LhQu7cXEQ4KclJDpzd5Co3Bz8ObjjKH4GU5GbLhtpWfiRKCuv7NlO2sWaeGZ7R1vupT9O++7zzfmf3mXcmgRIjgRLDBtbGBtbGBtbGBtbGBtbGL3CKTtAszcdk1l0z9VOoMgQzSrcRD2N0x69AEjhJbxEPNfTZr0AS2JBHPATmsbuENr8JfEMX6KB7vPN8/0FzPvNzbk0oogZ+owN0ie67x35PgCHaTteLzF+jbXQEIalANK7pqWfshF7SJvdzJX2k03QTzv76TrfooVtThZBE3SUytLlI3QW+AptfewVOu7x46qrpIp3zZAjMEzWwaYkOmi4Y66LH+N5m5iI26C6cf3SYTtFGRMgjDWxuqHrP2D1dhtMKJux8kZowmPMlg4qkgQ9oD3Qxfd0bVCTdJc6hj2gN6S6Rhj6iNaQt0UDPaC10eKKd9CqoUNoS5kQz0GMSgrCGcsgxDwqzbfXROvwNGTpO96QTpC1RiHmCzdJu2kpbIL+ABzg3l+nXI7pKXxGCKIH/Ffs+rI0NrI0NrI0NrI0NrI0NrM0nAAAA//+VH0U5AAAABklEQVQDAKD0X27e7aSjAAAAAElFTkSuQmCC';
const trayImage = nativeImage.createFromBuffer(Buffer.from(TRAY_B64, 'base64'), { scaleFactor: 2 });
if (process.platform === 'darwin') trayImage.setTemplateImage(true);

// sizing/matters.swift
const OPEN = { w: 640, h: 190 };
const SHADOW_PADDING = 20;
const WINDOW = { w: OPEN.w, h: OPEN.h + SHADOW_PADDING };

let tray;
let peerIp = null;
let peerHost = null;
const selfId = crypto.randomUUID();

let preventClose = false; // menu contextuel ouvert / drag en cours de ciblage
let dragActive = false;  // un drag de fichier est en cours (detecteur global)
let dragDaemon = null;
let probedGeo = null;    // geometrie de l'encoche physique (built-in), si sondee

// Une "encoche" par ecran. Chaque objet :
//   { win, display, geo, state, lastInsideAt, holdOpenUntil, shrinkTimer, hoverSince }
const notches = [];

const inboxDir = path.join(app.getPath('downloads'), 'NotchDrop');
fs.mkdirSync(inboxDir, { recursive: true });
let shelfStore;
let prefsStore;
let settingsWin = null;
const getPrefs = () => (prefsStore ? prefsStore.all() : {});

// Media / calendrier / HUD
let mediaHandle = null;
let lastMedia = null;
let hudHandle = null;
let mediaKeysHandle = null;
let accessibilityStatus = null;   // 'ok' | 'need-accessibility'
let accessibilityPrompted = false;
let calendarData = null;
let calendarTimer = null;

// Guide l'utilisateur pour accorder l'Accessibilite au helper d'interception de
// touches (une fois par session ; une fois accordee, l'interception reprend seule).
function promptAccessibilityOnce() {
  if (accessibilityPrompted) return;
  accessibilityPrompted = true;
  try {
    const { Notification } = require('electron');
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'NotchZFX — masquer les jauges natives',
        body: "Active « NotchZFX MediaKeys » dans Reglages > Confidentialite et securite > Accessibilite. Clique ici pour ouvrir.",
      });
      n.on('click', () => { try { shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'); } catch (_) {} });
      n.show();
    }
  } catch (_) {}
}

// ---- Couleur dominante de la pochette (pour teinter le spectre) ----
// L'artwork Spotify est une URL distante -> on la telecharge cote main (pas de
// restriction CORS ici), on decode via nativeImage et on calcule une couleur VIVE
// moyenne (ponderee par la saturation). Mise en cache par URL.
let artColorCache = { url: null, color: null };
function computeArtColor(url, cb) {
  if (!url || !/^https?:/.test(url)) return cb(null);
  if (url === artColorCache.url) return cb(artColorCache.color);
  let done = false;
  const finish = (c) => { if (done) return; done = true; cb(c); };
  let req;
  try {
    req = https.get(url, { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return finish(null); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const img = nativeImage.createFromBuffer(Buffer.concat(chunks));
          const sz = img.getSize();
          if (!sz.width) return finish(null);
          const bmp = img.toBitmap(); // BGRA
          let r = 0, g = 0, b = 0, wsum = 0;
          const step = Math.max(1, Math.floor((sz.width * sz.height) / 1500)) * 4;
          for (let i = 0; i + 3 < bmp.length; i += step) {
            const bb = bmp[i], gg = bmp[i + 1], rr = bmp[i + 2];
            const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
            if (mx < 30) continue;                      // trop sombre
            if (mn > 220) continue;                     // quasi blanc (tous canaux hauts)
            const sat = mx === 0 ? 0 : (mx - mn) / mx;  // 0..1
            if (sat < 0.12) continue;                   // gris
            const w = 0.3 + sat * sat * 3;              // favorise fortement les couleurs vives
            r += rr * w; g += gg * w; b += bb * w; wsum += w;
          }
          if (wsum < 1) return finish(null);
          let R = r / wsum, G = g / wsum, B = b / wsum;
          const mx = Math.max(R, G, B);
          if (mx > 0 && mx < 170) { const k = 170 / mx; R *= k; G *= k; B *= k; } // rehausse la luminosite
          const hex = '#' + [R, G, B].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
          artColorCache = { url, color: hex };
          finish(hex);
        } catch (_) { finish(null); }
      });
    });
    req.on('error', () => finish(null));
    req.on('timeout', () => { try { req.destroy(); } catch (_) {} finish(null); });
  } catch (_) { finish(null); }
}

// ---- Helpers multi-encoches ----
const alive = (n) => !!n && !!n.win && !n.win.isDestroyed();
const liveNotches = () => notches.filter(alive);
function broadcast(channel, payload) {
  liveNotches().forEach((n) => n.win.webContents.send(channel, payload));
}
function broadcastExcept(sender, channel, payload) {
  liveNotches().forEach((n) => { if (n.win.webContents !== sender) n.win.webContents.send(channel, payload); });
}
function touchAll() { const t = Date.now(); notches.forEach((n) => { n.lastInsideAt = t; }); }
function notchForSender(wc) { return liveNotches().find((n) => n.win.webContents === wc) || null; }
function winForSender(wc) { const n = notchForSender(wc); return n ? n.win : (liveNotches()[0] && liveNotches()[0].win); }

// L'encoche sous le curseur (ecran actif), sinon la premiere disponible.
function notchAtCursor() {
  const p = screen.getCursorScreenPoint();
  const disp = screen.getDisplayNearestPoint(p);
  return liveNotches().find((n) => n.display.id === disp.id) || liveNotches()[0] || null;
}

// Geometrie d'un ecran : encoche physique sondee sur l'ecran interne. Un ecran
// SANS encoche physique (externe) recoit une encoche fermee TRES FINE (discrete)
// -> pas de gros bandeau noir ; elle s'ouvre quand meme par le haut-centre.
function displayGeo(display) {
  if (probedGeo && display.internal) return { ...probedGeo };
  const base = baseGeometry(display);
  if (!display.internal) {
    // Encoche externe : moitie plus fine (6px) mais bien arrondie. br est borne par
    // (h - tr) dans notchPath -> tr petit (2) pour laisser l'arrondi du bas s'exprimer (br 4).
    return { closedWidth: 140, closedHeight: 6, tr: 2, br: 4, hasNotch: false, simulated: true };
  }
  return base;
}

const drawnClosedW = (n) => n.geo.closedWidth + 8;

function sendGeometry(n) {
  if (!alive(n)) return;
  n.win.webContents.send('geometry', {
    closedW: n.geo.closedWidth + 8,
    closedH: n.geo.closedHeight,
    physicalW: n.geo.closedWidth,
    openW: OPEN.w,
    openH: OPEN.h,
    simulated: n.geo.simulated,
    tr: n.geo.tr,   // rayons fermes optionnels (encoche externe arrondie)
    br: n.geo.br,
  });
}

// Largeur ajoutee a l'encoche fermee pendant la lecture (doit egaler LIVE_EXTRA
// cote renderer) : place la pochette a gauche et le spectre a droite hors encoche.
const LIVE_EXTRA = 84;
function isLiveClosed(n) {
  return !n.fixed && !n.geo.simulated
    && prefsStore && prefsStore.get('showMusicLiveActivity')
    && !!(lastMedia && lastMedia.available && lastMedia.playing);
}
function closedWinDims(n) {
  const extra = isLiveClosed(n) ? LIVE_EXTRA : 0;
  // Hauteur mini 6 px (encoche fine des ecrans externes -> peu de zone bloquante).
  return { w: Math.max(80, Math.round(n.geo.closedWidth + 8 + extra)), h: Math.max(6, Math.round(n.geo.closedHeight)) };
}

// Elargit/retrecit la fenetre fermee quand la lecture demarre/s'arrete. On retrecit
// APRES le repli de la forme (380 ms) pour eviter un clip brutal du dessin.
function updateLiveClosed() {
  liveNotches().forEach((n) => {
    if (n.fixed || n.geo.simulated || n.state !== 'closed') return;
    const live = isLiveClosed(n);
    if (live === n._wasLive) return;
    n._wasLive = live;
    if (live) {
      setBounds(n, 'closed');
    } else {
      clearTimeout(n._liveShrinkT);
      n._liveShrinkT = setTimeout(() => {
        if (alive(n) && n.state === 'closed' && !isLiveClosed(n)) setBounds(n, 'closed');
      }, 380);
    }
  });
}

function setBounds(n, kind) {
  if (!alive(n)) return;
  const d = n.display;
  const y = process.platform === 'win32' ? d.workArea.y : d.bounds.y;
  if (n.fixed) {
    // Ecran externe : fenetre TOUJOURS a la taille ouverte -> zero redimensionnement
    // a l'ouverture (supprime le scintillement). Click-through quand ferme.
    n.win.setBounds({ x: Math.round(d.bounds.x + d.bounds.width / 2 - WINDOW.w / 2), y, width: WINDOW.w, height: WINDOW.h }, false);
    n.win.setIgnoreMouseEvents(kind !== 'open');
    return;
  }
  const size = kind === 'open' ? WINDOW : closedWinDims(n);
  n.win.setBounds({
    x: Math.round(d.bounds.x + d.bounds.width / 2 - size.w / 2),
    y,
    width: size.w,
    height: size.h,
  }, false);
}

function openNotch(n, tab) {
  if (!alive(n)) return;
  if (n.state !== 'open') {
    n.state = 'open';
    n.lastInsideAt = Date.now();
    clearTimeout(n.shrinkTimer);
    setBounds(n, 'open'); // agrandit AVANT l'animation pour laisser la place
    n.win.webContents.send('notch-state', { state: 'open', tab: tab || null });
  } else if (tab) {
    n.win.webContents.send('switch-tab', tab);
  }
}

// Ouvre l'encoche de l'ecran actif (curseur) — pour les evenements sans fenetre
// precise (reception reseau/AirDrop, IPC open-notch).
function openActiveNotch(tab, holdMs) {
  const n = notchAtCursor();
  if (!n) return;
  if (holdMs) n.holdOpenUntil = Date.now() + holdMs;
  openNotch(n, tab);
}

// Depot attrape par la fenetre native : les fichiers ont deja ete CONSOMMES cote
// Swift. On ouvre l'encoche de l'ecran ou a eu lieu le lacher et on y transmet les
// chemins avec la position curseur (coords fenetre) pour le routage (shelf/AirDrop/PC).
function handleCaughtDrop(paths) {
  if (!paths || !paths.length) return;
  const n = notchAtCursor();
  if (!alive(n)) return;
  n.holdOpenUntil = Date.now() + 1500;
  n.lastInsideAt = Date.now();
  if (n.state !== 'open') openNotch(n, 'shelf');
  const p = screen.getCursorScreenPoint();
  const nb = n.win.getBounds();
  n.win.webContents.send('external-drop', { paths, x: p.x - nb.x, y: p.y - nb.y });
}

function closeNotch(n) {
  if (!alive(n) || n.state === 'closed') return;
  n.state = 'closed';
  n.win.webContents.send('notch-state', { state: 'closed' });
  clearTimeout(n.shrinkTimer);
  if (n.fixed) {
    n.win.setIgnoreMouseEvents(true); // fenetre fixe : click-through immediat, pas de resize
  } else {
    // On retrecit APRES l'animation de fermeture (sinon la fenetre clipe la forme).
    n.shrinkTimer = setTimeout(() => { if (n.state === 'closed') setBounds(n, 'closed'); }, 380);
  }
}

// ---- Surveillance des receptions AirDrop.
// Les fichiers recus par AirDrop atterrissent dans ~/Downloads avec l'attribut
// etendu com.apple.quarantine dont l'agent est "sharingd". On surveille le dossier
// et, a l'arrivee d'un tel fichier, on l'ajoute au shelf (il RESTE dans Downloads).
function isAirdropFile(fullPath, cb) {
  execFile('xattr', ['-p', 'com.apple.quarantine', fullPath], (err, stdout) => {
    if (err) return cb(false); // pas de quarantine -> pas AirDrop
    // format: flags;timestamp;agentName;uuid
    const agent = String(stdout).trim().split(';')[2];
    cb(agent === 'sharingd');
  });
}

function startAirdropWatch(onAirdrop) {
  if (process.platform !== 'darwin') return;
  const dir = app.getPath('downloads');
  const seen = new Set();
  try { for (const f of fs.readdirSync(dir)) seen.add(f); } catch (_) {}

  const consider = (name) => {
    if (seen.has(name) || name.startsWith('.')) return;
    seen.add(name);
    const full = path.join(dir, name);
    // On laisse le temps a AirDrop de finaliser le fichier + poser la quarantine.
    setTimeout(() => {
      if (!fs.existsSync(full)) return;
      isAirdropFile(full, (yes) => { if (yes) onAirdrop(full); });
    }, 1200);
  };

  try {
    fs.watch(dir, (_event, filename) => { if (filename) consider(String(filename)); });
  } catch (err) {
    console.warn('surveillance AirDrop indisponible:', err.message);
  }
}

// ---- Surveillance des captures d'ecran -> etagere (comme AirDrop).
// Les captures macOS portent la metadonnee Spotlight kMDItemIsScreenCapture = 1.
// On lit le dossier de capture (defaults com.apple.screencapture location, defaut Bureau).
function isScreenshotFile(fullPath, cb) {
  execFile('mdls', ['-name', 'kMDItemIsScreenCapture', '-raw', fullPath], (err, stdout) => {
    if (err) return cb(false);
    cb(String(stdout).trim() === '1');
  });
}

// IMPORTANT : `defaults read ... location` renvoie une chaine ECHAPPEE (ex.
// "Capture d'écran" en toutes lettres), ce qui casse fs.existsSync sur les
// dossiers accentues (forme decomposee NFD). On lit donc l'export XML, dont la
// chaine est en vrai UTF-8.
function screenshotDir(cb) {
  execFile('defaults', ['export', 'com.apple.screencapture', '-'], (err, stdout) => {
    let dir = '';
    if (!err) {
      const m = String(stdout).match(/<key>location<\/key>\s*<string>([^<]*)<\/string>/);
      if (m) dir = m[1].trim();
    }
    dir = dir.replace(/^~(?=\/|$)/, os.homedir());
    if (!dir || !fs.existsSync(dir)) dir = app.getPath('desktop');
    cb(dir);
  });
}

function startScreenshotWatch(onShot) {
  if (process.platform !== 'darwin') return;
  screenshotDir((dir) => {
    const seen = new Set();
    try { for (const f of fs.readdirSync(dir)) seen.add(f); } catch (_) {}
    const consider = (name) => {
      if (seen.has(name) || name.startsWith('.')) return;
      seen.add(name);
      if (!/\.(png|jpg|jpeg|heic)$/i.test(name)) return;
      const full = path.join(dir, name);
      // Laisse macOS finaliser le fichier + poser la metadonnee.
      setTimeout(() => {
        if (!fs.existsSync(full)) return;
        isScreenshotFile(full, (yes) => { if (yes) onShot(full); });
      }, 900);
    };
    // fs.watch (FSEvents) pour la reactivite immediate...
    try {
      fs.watch(dir, (_event, filename) => { if (filename) consider(String(filename)); });
    } catch (err) {
      console.warn('surveillance captures indisponible:', err.message);
    }
    // ...double d'un sondage de secours (FSEvents rate parfois des evenements,
    // surtout avec des noms en forme decomposee).
    setInterval(() => {
      let files;
      try { files = fs.readdirSync(dir); } catch (_) { return; }
      for (const f of files) consider(f);
    }, 2000);
  });
}

// ---- HUD volume / luminosite : agrandit brievement l'encoche de l'ecran actif ----
const HUD_WIN = { w: 286, h: 86 };
function hudTargetNotch() {
  const n = notchAtCursor();
  if (alive(n) && !n.fixed && !n.geo.simulated) return n;
  return liveNotches().find((x) => x.display.internal && !x.geo.simulated) || null;
}
// NB : sur macOS 26 la jauge native (OSD) est dessinee IN-PROCESS par ControlCenter
// (impossible a tuer : SIP). La suppression se fait donc en amont, en CONSOMMANT les
// touches media via l'intercepteur (mediaKeyDaemon + MediaKeyInterceptor.app) — pas
// ici. showHud ne fait plus qu'afficher NOTRE HUD.
function showHud(kind, value, muted) {
  if (!prefsStore || !prefsStore.get('replaceSystemHUD')) return;
  const n = hudTargetNotch();
  if (!alive(n)) return;
  n.hudActive = true;
  n.lastInsideAt = Date.now();
  if (n.state === 'closed' && !n.fixed) {
    const d = n.display;
    const y = process.platform === 'win32' ? d.workArea.y : d.bounds.y;
    // Fenetre du HUD aussi large que l'encoche en lecture (encoche + 2 extensions).
    const hudW = Math.round(n.geo.closedWidth + 8 + LIVE_EXTRA);
    n.win.setBounds({ x: Math.round(d.bounds.x + d.bounds.width / 2 - hudW / 2), y, width: hudW, height: HUD_WIN.h }, false);
  }
  n.win.webContents.send('hud', { visible: true, kind, value, muted });
  clearTimeout(n.hudTimer);
  n.hudTimer = setTimeout(() => hideHud(n), 1600);
}
function hideHud(n) {
  if (!alive(n)) return;
  n.hudActive = false;
  n.win.webContents.send('hud', { visible: false });
  if (n.state === 'closed' && !n.fixed) {
    setTimeout(() => { if (alive(n) && !n.hudActive && n.state === 'closed') setBounds(n, 'closed'); }, 380);
  }
}

// ---- Calendrier : recupere les evenements et diffuse aux encoches ----
function refreshCalendar() {
  if (!prefsStore || !prefsStore.get('showCalendar')) {
    calendarData = { authorized: false, events: [], calendars: [], reminderLists: [], reminders: [] };
    broadcast('calendar', calendarData);
    return;
  }
  getCalendar(7).then((c) => { calendarData = c; broadcast('calendar', c); }).catch(() => {});
}

// ---- Suivi souris : ouverture (drag ou proximite haut-centre) + fermeture a la
// sortie, gere PAR ECRAN. On itere chaque encoche selon l'ecran ou est le curseur.
function startMouseTracking() {
  setInterval(() => {
    const live = liveNotches();
    if (!live.length) return;
    const now = Date.now();
    const p = screen.getCursorScreenPoint();
    const cursorDisp = screen.getDisplayNearestPoint(p);

    live.forEach((n) => {
      const d = n.display;
      const onThis = d.id === cursorDisp.id;
      const cx = d.bounds.x + d.bounds.width / 2;

      // Pendant un drag : ouvrir l'encoche de l'ecran actif quand le curseur
      // approche du haut-centre (zone DragDetector 640x190).
      if (dragActive) {
        if (onThis) {
          const inZone = Math.abs(p.x - cx) <= OPEN.w / 2 && p.y >= d.bounds.y && p.y <= d.bounds.y + OPEN.h;
          if (inZone) { n.lastInsideAt = now; if (n.state === 'closed') openNotch(n, 'shelf'); }
        }
        return;
      }

      if (n.state === 'open') {
        const b = n.win.getBounds();
        const inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + OPEN.h + 4;
        if (inside) n.lastInsideAt = now;
        // Fermeture 100 ms apres la sortie de la souris.
        if (now - n.lastInsideAt > 100 && now > n.holdOpenUntil && !preventClose) closeNotch(n);
        return;
      }

      // FERME (mains vides) : ouverture facilitee des que le curseur touche le bord
      // HAUT pres du centre (zone large). Respecte "Ouvrir au survol" + "Hover delay".
      const hoverEnabled = !prefsStore || prefsStore.get('openOnHover');
      if (onThis && hoverEnabled) {
        const wide = !prefsStore || prefsStore.get('expandHoverZone');
        const halfZone = Math.max(wide ? 150 : 90, drawnClosedW(n) / 2 + (wide ? 60 : 10));
        const nearTop = p.y >= d.bounds.y && p.y <= d.bounds.y + 6;
        const nearCenter = Math.abs(p.x - cx) <= halfZone;
        const delay = Math.max(0, Math.round((prefsStore ? prefsStore.get('hoverDelay') : 0.3) * 1000));
        if (nearTop && nearCenter) {
          if (!n.hoverSince) n.hoverSince = now;
          if (now - n.hoverSince >= delay) openNotch(n, 'shelf');
        } else n.hoverSince = 0;
      } else {
        n.hoverSince = 0;
      }
    });
  }, 33);
}

function createNotch(display) {
  // Encoche externe desactivee dans les preferences -> pas de fenetre sur cet ecran.
  if (!display.internal && prefsStore && !prefsStore.get('showExternalNotch')) return null;
  const win = new BrowserWindow({
    width: WINDOW.w,
    height: WINDOW.h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // transparent explicite : evite le scintillement (ecran externe)
    resizable: false,
    movable: false,
    hasShadow: false,          // BoringNotchSkyLightWindow.swift:62
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,          // nonactivatingPanel : ne vole pas le focus
    acceptFirstMouse: true,    // 1er clic/drop pris sans activer la fenetre
    fullscreenable: false,
    roundedCorners: false,
    // NSPanel + pas de contrainte de cadre : indispensable pour recouvrir
    // la barre des menus (sinon macOS repousse la fenetre en dessous).
    ...(process.platform === 'darwin' ? { type: 'panel', enableLargerThanScreen: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const n = {
    win, display, geo: displayGeo(display), state: 'closed',
    lastInsideAt: 0, holdOpenUntil: 0, shrinkTimer: null, hoverSince: 0,
    fixed: !display.internal, // ecran externe : fenetre a taille fixe (anti-scintillement)
  };
  notches.push(n);

  // Niveau .mainMenu + 3 (=27) comme Boring Notch : au-dessus de la barre des menus
  // (24) SANS etre a un niveau extreme (screen-saver=1000), qui fait disparaitre la
  // fenetre pendant les transitions de Bureau.
  win.setAlwaysOnTop(true, 'main-menu', 3);
  // Visible sur TOUS les bureaux + au-dessus du plein ecran. skipTransformProcessType:
  // l'app est deja un agent (dock cache) -> evite de changer le type de process a
  // chaque appel (source de clignotement lors des transitions de Space).
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  // .stationary : empeche la fenetre de glisser (donc de disparaitre) pendant les
  // transitions de Bureau / Mission Control. Electron ne l'expose pas -> pose FFI.
  applyStationary(win);
  try { if (prefsStore && prefsStore.get('hideFromScreenRecording')) win.setContentProtection(true); } catch (_) {}
  setBounds(n, 'closed');
  setTimeout(() => { if (alive(n) && n.state === 'closed') setBounds(n, 'closed'); }, 300);
  win.on('closed', () => { const i = notches.indexOf(n); if (i >= 0) notches.splice(i, 1); });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    setBounds(n, 'closed');
    applyStationary(win); // base collectionBehavior (sans effet de bord)
    sendGeometry(n);
    win.webContents.send('self-info', { ip: net.localIPv4(), inbox: inboxDir, host: os.hostname() });
    win.webContents.send('prefs', getPrefs());
    if (lastMedia) win.webContents.send('media', lastMedia);
    if (calendarData) win.webContents.send('calendar', calendarData);
    win.webContents.send('notch-state', { state: 'closed' });
    if (peerIp) win.webContents.send('peer-updated', { ip: peerIp, host: peerHost });
    win.webContents.send('shelf-items', shelfStore.load());
  });
  return n;
}

// Reconcilie les encoches avec les ecrans actuels (branchement/debranchement,
// changement de resolution) : cree les manquantes, retire celles des ecrans partis.
function syncNotches() {
  const displays = screen.getAllDisplays();
  const ids = new Set(displays.map((d) => d.id));
  const allScreens = !prefsStore || prefsStore.get('showOnAllScreens');
  // Sur ecran externe : uniquement si multi-ecran ET encoche externe autorisee.
  const showExternal = allScreens && (!prefsStore || prefsStore.get('showExternalNotch'));
  for (const n of notches.slice()) {
    // Ecran parti, ou encoche externe desactivee dans les prefs -> on detruit.
    if (!ids.has(n.display.id) || (!n.display.internal && !showExternal)) {
      try { if (alive(n)) n.win.destroy(); } catch (_) {}
    }
  }
  for (const d of displays) {
    if (!d.internal && !showExternal) continue;
    const n = notches.find((x) => x.display.id === d.id);
    if (!n) { createNotch(d); }
    else {
      // IMPORTANT : ne repositionne QUE si la geometrie a vraiment change.
      // display-metrics-changed se declenche pendant les transitions de Bureau /
      // ouverture d'app / affichage du bureau, avec des metriques identiques -> sans
      // ce garde-fou, setBounds/sendGeometry font clignoter (disparaitre) l'encoche.
      const b = n.display.bounds, nb = d.bounds;
      const changed = b.x !== nb.x || b.y !== nb.y || b.width !== nb.width || b.height !== nb.height
        || n.display.scaleFactor !== d.scaleFactor || n.fixed !== !d.internal;
      n.display = d;
      if (changed) {
        n.geo = displayGeo(d); n.fixed = !d.internal;
        setBounds(n, n.state === 'open' ? 'open' : 'closed'); sendGeometry(n);
      }
    }
  }
}

function setupTray() {
  try {
    tray = new Tray(trayImage);
    tray.setToolTip('NotchZFX');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Ouvrir le dossier de reception', click: () => shell.openPath(inboxDir) },
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() },
    ]));
  } catch (err) {
    console.warn('tray indisponible:', err.message);
  }
}

function applyTrayVisibility(visible) {
  if (visible) { if (!tray || tray.isDestroyed()) setupTray(); }
  else if (tray && !tray.isDestroyed()) { tray.destroy(); tray = null; }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  shelfStore = new ShelfStore(app.getPath('userData'));
  prefsStore = new PrefsStore(app.getPath('userData'));
  prefsStore.load();
  // Aligne l'element de connexion sur la preference sauvegardee.
  try {
    if (process.platform !== 'linux') {
      app.setLoginItemSettings({ openAtLogin: !!prefsStore.get('launchAtLogin') });
    }
  } catch (_) {}

  // Une encoche par ecran (les externes seulement si la preference l'autorise).
  screen.getAllDisplays().forEach((d) => createNotch(d));
  setupTray();
  startMouseTracking();

  // Detecteur + attrapeur natif de drop (macOS) : ouvre l'encoche a l'approche et,
  // surtout, CONSOMME le fichier lache sur la zone via une vraie fenetre native
  // (dragMonitor.swift). Electron ne touche donc plus au drop -> fini la copie
  // parasite sur le bureau. Les chemins arrivent via onDrop.
  dragDaemon = startDragMonitor({
    onStart: () => { dragActive = true; },
    onEnd: () => { dragActive = false; },
    onDrop: (paths) => { handleCaughtDrop(paths); },
  });

  // Sonde asynchrone de la vraie encoche physique (Mac) : affine l'encoche interne.
  probeMacNotch().then((probed) => {
    if (!probed) return;
    probedGeo = probed;
    liveNotches().forEach((n) => {
      if (n.display.internal) {
        n.geo = { ...probed };
        sendGeometry(n);
        if (n.state === 'closed') setBounds(n, 'closed');
      }
    });
  });

  // Serveur de reception : non bloquant, avec nouvelle tentative si le port est pris.
  // On depose sur l'encoche de l'ecran actif ; les autres se synchronisent via le
  // broadcast de sauvegarde du shelf.
  const onFileReceived = (savedPath, name, intent) => {
    // Fichier relaye depuis le PC pour AirDrop : sur le Mac, on ouvre directement le
    // panneau AirDrop avec ce fichier (au lieu de l'ajouter au shelf).
    if (intent === 'airdrop' && process.platform === 'darwin' && airdropPaths([savedPath])) {
      openActiveNotch('home', 1500);
      return;
    }
    const n = notchAtCursor();
    if (alive(n)) n.win.webContents.send('file-received', { path: savedPath, name });
    openActiveNotch('shelf', 3000);
  };
  const tryStartServer = (attempt) => {
    net.startServer(inboxDir, onFileReceived).catch((err) => {
      console.warn(`[net] serveur indisponible (${err.code || err.message}), tentative ${attempt}/5`);
      if (attempt < 5) setTimeout(() => tryStartServer(attempt + 1), 3000);
    });
  };
  tryStartServer(1);

  net.startDiscovery(selfId, (ip, host) => {
    if (ip && (ip !== peerIp || host !== peerHost)) {
      peerIp = ip;
      peerHost = host;
      broadcast('peer-updated', { ip, host });
    }
  });

  // Reception AirDrop -> ajoute au shelf (le fichier reste dans ~/Downloads).
  startAirdropWatch((airdropPath) => {
    if (!prefsStore || prefsStore.get('airdropToShelf')) onFileReceived(airdropPath, path.basename(airdropPath));
  });

  // Captures d'ecran -> etagere (comme AirDrop).
  startScreenshotWatch((shotPath) => {
    if (!prefsStore || prefsStore.get('screenshotToShelf')) onFileReceived(shotPath, path.basename(shotPath));
  });

  // Media (now playing via AppleScript) : diffuse a toutes les encoches.
  mediaHandle = mediaLib.startMedia({
    getSource: () => (prefsStore ? prefsStore.get('musicSource') : 'spotify'),
    onUpdate: (info) => {
      lastMedia = info;
      if (info && info.artworkUrl === artColorCache.url) info.artColor = artColorCache.color; // couleur en cache
      broadcast('media', info);
      updateLiveClosed();
      // Couleur de la pochette (async si nouvelle URL) -> re-broadcast quand prete.
      computeArtColor(info && info.artworkUrl, (color) => {
        if (lastMedia !== info) return;
        if ((info.artColor || null) === (color || null)) return;
        info.artColor = color || null;
        broadcast('media', info);
      });
    },
    intervalMs: 1000,
  });

  // HUD volume / luminosite (helper natif : CoreAudio + DisplayServices).
  hudHandle = startHudMonitor({
    onVolume: (v, muted) => showHud('volume', v, muted),
    onBrightness: (v) => showHud('brightness', v, false),
    onLog: () => {},
  });

  // Intercepteur de touches media : consomme volume/luminosite pour SUPPRIMER la
  // jauge native (macOS 26 la dessine in-process dans ControlCenter -> pas tuable).
  // Necessite la permission Accessibilite ; on guide l'utilisateur si absente.
  if (!prefsStore || prefsStore.get('replaceSystemHUD')) {
    mediaKeysHandle = startMediaKeys({
      onStatus: (st) => {
        accessibilityStatus = st;
        if (st === 'need-accessibility') promptAccessibilityOnce();
      },
      onKey: () => {}, // le changement est applique par le helper ; le HUDMonitor affiche le HUD
      onLog: () => {},
    });
  }

  // Calendrier (EventKit via helper compile) : pre-build + 1er chargement + refresh.
  buildCalendarHelper().catch(() => {});
  refreshCalendar();
  calendarTimer = setInterval(refreshCalendar, 5 * 60 * 1000);

  // Debounce : les transitions (Bureau/Mission Control/plein ecran) emettent des
  // rafales de display-metrics-changed ; on les coalesce pour ne pas repositionner
  // l'encoche a repetition (clignotement).
  let syncTimer = null;
  const syncSoon = () => { clearTimeout(syncTimer); syncTimer = setTimeout(syncNotches, 250); };
  screen.on('display-metrics-changed', syncSoon);
  screen.on('display-added', syncSoon);
  screen.on('display-removed', syncSoon);
});

// ---- IPC ----
ipcMain.on('open-notch', (e, tab) => { const n = notchForSender(e.sender); if (n) openNotch(n, tab); else openActiveNotch(tab); });
ipcMain.on('set-prevent-close', (_e, on) => { preventClose = !!on; if (on) touchAll(); });

// Controles media : agissent sur la source selectionnee.
ipcMain.on('media-control', (_e, action) => {
  mediaLib.mediaControl(action, prefsStore ? prefsStore.get('musicSource') : 'spotify').catch(() => {});
});
ipcMain.on('media-seek', (_e, posSec) => {
  mediaLib.mediaSeek(posSec, prefsStore ? prefsStore.get('musicSource') : 'spotify').catch(() => {});
});

ipcMain.handle('send-files', async (_e, paths) => {
  if (!peerIp) return { ok: false, error: 'Aucun pair detecte' };
  const results = [];
  for (const p of paths) {
    try {
      await net.sendFile(peerIp, p);
      results.push({ path: p, ok: true });
    } catch (err) {
      results.push({ path: p, ok: false, error: String(err) });
    }
  }
  return { ok: true, results };
});

// Vignette de fichier : uniquement pour les images (decodage nativeImage, sur).
// NB : on n'utilise PAS app.getFileIcon() -> sur Electron 43 / macOS 26 il fait
// planter (SIGTRAP) un worker du ThreadPool. Pour les non-images, on renvoie null
// et le renderer affiche un cartouche avec l'extension.
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.tiff'];
const thumbCache = new Map();
const THUMB_CACHE_MAX = 200;
ipcMain.handle('get-thumb', async (_e, filePath) => {
  if (thumbCache.has(filePath)) return thumbCache.get(filePath);
  let dataUrl = null;
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTS.includes(ext)) {
      const img = nativeImage.createFromPath(filePath);
      if (!img.isEmpty()) {
        const { width, height } = img.getSize();
        const scale = 112 / Math.max(width, height); // 56pt @2x
        dataUrl = img.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'good',
        }).toDataURL();
      }
    }
  } catch (_) { /* le renderer affiche le cartouche d'extension */ }
  if (dataUrl) {
    if (thumbCache.size >= THUMB_CACHE_MAX) {
      thumbCache.delete(thumbCache.keys().next().value); // eviction du plus ancien
    }
    thumbCache.set(filePath, dataUrl);
  }
  return dataUrl;
});

// Depot de texte/lien : sauvegarde en .txt dans le dossier de reception (façon
// TemporaryFileStorageService de Boring Notch) et renvoie le chemin cree.
ipcMain.handle('save-text', (_e, text) => {
  try {
    const firstWords = String(text).trim().slice(0, 30).replace(/\s+/g, ' ') || 'texte';
    const dest = net.uniquePath(path.join(inboxDir, net.sanitizeName(firstWords) + '.txt'));
    fs.writeFileSync(dest, String(text));
    return dest;
  } catch (err) {
    console.warn('save-text echoue:', err.message);
    return null;
  }
});

// Sauvegarde + synchronisation du shelf sur toutes les encoches (memes fichiers).
ipcMain.on('shelf-save', (e, items) => {
  shelfStore.save(items);
  broadcastExcept(e.sender, 'shelf-items', items);
});

// Menu contextuel d'items du shelf (façon ShelfItemViewModel.swift, multi-selection).
ipcMain.on('item-menu', (e, payload) => {
  preventClose = true;
  const paths = payload.paths || [];
  const suffix = paths.length > 1 ? ` (${paths.length})` : '';
  const send = (action) => e.sender.send('menu-action', { action, paths });
  const template = [
    { label: 'Ouvrir' + suffix, click: () => send('open') },
    {
      label: process.platform === 'darwin' ? 'Afficher dans le Finder' : "Afficher dans l'Explorateur",
      click: () => send('reveal'),
    },
    { type: 'separator' },
    { label: (peerHost ? `Envoyer a ${peerHost}` : 'Envoyer au PC') + suffix, enabled: !!peerIp, click: () => send('send-peer') },
  ];
  if (process.platform === 'darwin') {
    template.push({ label: 'Partager via AirDrop…' + suffix, click: () => send('airdrop') });
  }
  template.push({ type: 'separator' }, { label: 'Retirer' + suffix, click: () => send('remove') });
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: winForSender(e.sender), callback: () => { preventClose = false; touchAll(); } });
});

// Menu contextuel du panneau (hors items) : selection / vidage.
ipcMain.on('panel-menu', (e) => {
  preventClose = true;
  const send = (action) => e.sender.send('menu-action', { action });
  const menu = Menu.buildFromTemplate([
    { label: 'Tout selectionner', click: () => send('select-all') },
    { type: 'separator' },
    { label: 'Vider le shelf', click: () => send('clear-shelf') },
  ]);
  menu.popup({ window: winForSender(e.sender), callback: () => { preventClose = false; touchAll(); } });
});

// AirDrop DIRECT (pas le menu de partage complet) : on delegue a l'app native
// DragCatcher qui appelle NSSharingService(.sendViaAirDrop) -> ouvre directement
// le panneau AirDrop ou l'utilisateur n'a qu'a choisir le destinataire.
function airdropPaths(paths) {
  if (process.platform !== 'darwin' || !paths || !paths.length) return false;
  if (!dragDaemon || !dragDaemon.stdin || !dragDaemon.stdin.writable) {
    console.warn('AirDrop indisponible : attrapeur natif absent');
    return false;
  }
  try {
    const b64 = Buffer.from(JSON.stringify(paths)).toString('base64');
    dragDaemon.stdin.write('AIRDROP\t' + b64 + '\n');
    return true;
  } catch (err) {
    console.warn('AirDrop echoue:', err.message);
    return false;
  }
}
ipcMain.on('airdrop', (_e, { paths }) => airdropPaths(paths));

// Relais AirDrop depuis le PC : on envoie chaque fichier au pair (Mac) avec l'intent
// 'airdrop'. A l'arrivee, le Mac ouvre le panneau AirDrop (cf. onFileReceived).
ipcMain.on('airdrop-via-peer', (_e, { paths }) => {
  if (!peerIp || !paths || !paths.length) return;
  paths.forEach((p) => net.sendFile(peerIp, p, 'airdrop').catch((err) => console.warn('relais AirDrop echoue:', err.message)));
});

// Menu de partage complet (autres services) — conserve au cas ou.
ipcMain.on('share-menu', (e, { paths, x, y }) => {
  if (process.platform !== 'darwin' || !paths || !paths.length) return;
  try {
    preventClose = true;
    const menu = new ShareMenu({ filePaths: paths });
    menu.popup({
      window: winForSender(e.sender),
      x: Math.round(x || 0),
      y: Math.round(y || 0),
      callback: () => { preventClose = false; touchAll(); },
    });
  } catch (err) {
    preventClose = false;
    console.warn('share menu echoue:', err.message);
  }
});

// Selecteur de fichiers (clic sur une zone de partage, façon FileShareView).
ipcMain.handle('pick-files', async () => {
  preventClose = true;
  try {
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Selectionner des fichiers',
    });
    return res.canceled ? [] : res.filePaths;
  } finally {
    preventClose = false;
    touchAll();
  }
});

// Menu de l'engrenage (le gear de BoringHeader ouvre les Settings ; ici un menu natif).
ipcMain.on('gear-menu', (e) => {
  preventClose = true;
  const menu = Menu.buildFromTemplate([
    { label: `Cette machine : ${net.localIPv4()}`, enabled: false },
    { label: peerIp ? `Pair : ${peerHost || ''} ${peerIp}` : 'Pair : aucun', enabled: false },
    { type: 'separator' },
    { label: 'Ouvrir le dossier de reception', click: () => shell.openPath(inboxDir) },
    { label: 'Vider le shelf', click: () => e.sender.send('menu-action', { action: 'clear-shelf' }) },
    { type: 'separator' },
    { label: 'Quitter NotchDrop', click: () => app.quit() },
  ]);
  menu.popup({ window: winForSender(e.sender), callback: () => { preventClose = false; touchAll(); } });
});

// ---- Fenetre Parametres ----
function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 580,
    minWidth: 640,
    minHeight: 480,
    title: 'Parametres NotchDrop',
    resizable: true,
    fullscreenable: false,
    minimizable: true,
    maximizable: false,
    show: false,
    backgroundColor: '#ececee',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 13, y: 15 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.focus();
    try { app.focus({ steal: true }); } catch (_) {}
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

ipcMain.on('open-settings', () => openSettingsWindow());

ipcMain.handle('get-prefs', () => getPrefs());

const VERSION_NAME = 'Flying Rabbit 🐇';
function settingsCalendars() {
  const out = [];
  if (calendarData) {
    (calendarData.calendars || []).forEach((c) => out.push({ id: c.id, title: c.title, color: c.color, type: 'event' }));
    (calendarData.reminderLists || []).forEach((c) => out.push({ id: c.id, title: c.title, color: c.color, type: 'reminder' }));
  }
  return out;
}
ipcMain.handle('settings-info', () => ({
  ip: net.localIPv4(),
  inbox: inboxDir,
  peer: peerIp,
  peerHost: peerHost,
  version: app.getVersion(),
  versionName: VERSION_NAME,
  displays: screen.getAllDisplays().map((d) => ({
    id: d.id,
    name: d.label || (d.internal ? 'Ecran integre' : 'Ecran externe'),
  })),
  calendars: settingsCalendars(),
}));

ipcMain.on('set-pref', (_e, { key, value } = {}) => {
  if (!prefsStore || !key) return;
  prefsStore.set(key, value);
  // Effets de bord selon la preference.
  if (key === 'launchAtLogin') {
    try { if (process.platform !== 'linux') app.setLoginItemSettings({ openAtLogin: !!value }); } catch (_) {}
  }
  if (key === 'showExternalNotch' || key === 'showOnAllScreens') syncNotches();
  if (key === 'showCalendar') refreshCalendar();
  if (key === 'hideFromScreenRecording') {
    liveNotches().forEach((n) => { try { n.win.setContentProtection(!!value); } catch (_) {} });
  }
  if (key === 'showMenuBarIcon') applyTrayVisibility(!!value);
  // Les encoches (renderer) suivent les autres prefs en direct via ce broadcast.
  broadcast('prefs', getPrefs());
});

ipcMain.on('clear-shelf', () => { if (shelfStore) { shelfStore.save([]); broadcast('shelf-items', []); } });
ipcMain.on('open-inbox', () => shell.openPath(inboxDir));
ipcMain.on('open-external', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('check-updates', () => { shell.openExternal('https://github.com'); return { ok: true }; });

ipcMain.on('start-drag', (e, filePaths) => {
  try {
    const files = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean);
    if (!files.length) return;
    e.sender.startDrag({ files, icon: iconImage });
  } catch (err) {
    console.warn('drag natif echoue:', err.message);
  }
});

ipcMain.on('dbg', (_e, m) => console.log('[renderer]', m));
ipcMain.on('open-file', (_e, p) => shell.openPath(p));
ipcMain.on('reveal-file', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('quit-app', () => app.quit());

app.on('window-all-closed', () => { /* reste actif en tray */ });
app.on('will-quit', () => {
  if (dragDaemon) dragDaemon.kill();
  if (mediaHandle) mediaHandle.stop();
  if (hudHandle) hudHandle.kill();
  if (mediaKeysHandle) mediaKeysHandle.kill();
  if (calendarTimer) clearInterval(calendarTimer);
});
