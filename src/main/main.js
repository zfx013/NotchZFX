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
const updater = require('./updater');
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
// AirNotch : table des appareils decouverts sur le reseau (ip -> profil), au lieu
// d'un seul pair. Chaque entree : { ip, id, host, name, os, form, mine, group, lastSeen }.
const peers = new Map();
let selfForm = 'desktop'; // 'laptop' | 'desktop' (detecte au demarrage, best-effort)
const selfId = crypto.randomUUID();
let deviceId = selfId; // identite STABLE (chargee/generee depuis les prefs au demarrage)

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

// ---- AirNotch : profil de l'appareil + table de pairs ------------------------
const osCode = () => (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux');

// Groupe d'appairage : hash du code saisi (vide = pas de code). Deux machines qui
// partagent le meme code se reconnaissent comme "les tiennes" (badge + mode prive).
function pairGroup() {
  const code = (prefsStore && prefsStore.get('airnotchPairCode') || '').trim();
  if (!code) return '';
  return crypto.createHash('sha1').update('notchzfx:' + code).digest('hex').slice(0, 16);
}

// Profil annonce en broadcast (relu a chaque emission via getInfo).
function selfProfile() {
  const custom = (prefsStore && prefsStore.get('airnotchDeviceName') || '').trim();
  return {
    id: deviceId,
    host: os.hostname(),
    name: custom || os.hostname(),
    os: osCode(),
    form: selfForm,
    group: pairGroup(),
  };
}

// Identite jointe a chaque envoi (pour authentification/affichage cote destinataire).
function selfIdentity() {
  return { id: deviceId, name: selfProfile().name, group: pairGroup() };
}

// ---- Controle d'acces a la reception (modele AirDrop) -----------------------
const pendingPrompts = new Map(); // coalesce les confirmations d'un meme appareil

function promptAccept(meta) {
  const key = meta.deviceId || meta.name || String(peers.size);
  if (pendingPrompts.has(key)) return pendingPrompts.get(key);
  const p = (async () => {
    const name = meta.name || 'Un appareil';
    try { app.focus({ steal: true }); } catch (_) {}
    const r = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Refuser', 'Accepter', 'Toujours accepter'],
      defaultId: 1,
      cancelId: 0,
      message: `${name} veut t'envoyer « ${meta.filename || 'un fichier'} »`,
      detail: "Cet appareil ne fait pas partie des tiens (pas le meme code d'appairage).",
    });
    if (r.response === 0) return false;
    if (r.response === 2 && meta.deviceId) {
      const trusted = (prefsStore.get('airnotchTrusted') || []).slice();
      if (!trusted.some((t) => t.id === meta.deviceId)) {
        trusted.push({ id: meta.deviceId, name });
        prefsStore.set('airnotchTrusted', trusted);
      }
    }
    return true;
  })().finally(() => pendingPrompts.delete(key));
  pendingPrompts.set(key, p);
  return p;
}

// Autorise (ou non) un fichier entrant AVANT de le telecharger.
async function authorizeIncoming(meta) {
  const mode = prefsStore ? prefsStore.get('airnotchAcceptFrom') : 'paired';
  if (mode === 'nobody') return false;
  if (mode === 'everyone') return true;
  // mode 'paired' : memes appareils (meme code) OU appareil deja approuve, sinon on demande.
  const myGroup = pairGroup();
  if (meta.group && myGroup && meta.group === myGroup) return true;
  const trusted = prefsStore.get('airnotchTrusted') || [];
  if (meta.deviceId && trusted.some((t) => t.id === meta.deviceId)) return true;
  return promptAccept(meta);
}

// Liste des pairs visibles, triee (les tiens d'abord, puis par nom).
function peerList() {
  return Array.from(peers.values())
    .map((p) => ({ ip: p.ip, host: p.host, name: p.name, os: p.os, form: p.form, mine: p.mine }))
    .sort((a, b) => (a.mine === b.mine ? (a.name || '').localeCompare(b.name || '') : a.mine ? -1 : 1));
}

// Premier Mac decouvert : sert de relais AirDrop pour les PC.
function macPeer() {
  for (const p of peers.values()) if (p.os === 'mac') return p;
  return null;
}

function pushPeers() {
  broadcast('peers-updated', peerList());
}

// Detection best-effort portable/fixe (une fois au demarrage).
function detectForm() {
  if (process.platform === 'darwin') {
    // hw.model ne dit plus "MacBook" sur Apple Silicon (ex. "Mac17,2") : on se fie
    // a la presence d'une batterie interne (portables uniquement).
    execFile('pmset', ['-g', 'batt'], (err, out) => {
      if (!err && /InternalBattery/.test(out)) selfForm = 'laptop';
    });
  } else if (process.platform === 'win32') {
    // Presence d'une batterie => portable. PACKAGE (chassis) via PowerShell.
    execFile('powershell', ['-NoProfile', '-Command',
      '(Get-CimInstance Win32_Battery | Measure-Object).Count'], (err, out) => {
      if (!err && parseInt(String(out).trim(), 10) > 0) selfForm = 'laptop';
    });
  }
}

// Retire les pairs qui n'ont plus annonce depuis >10 s (ils annoncent toutes les 3 s).
function expirePeers() {
  const now = Date.now();
  let changed = false;
  for (const [ip, p] of peers) {
    if (now - p.lastSeen > 10000) { peers.delete(ip); changed = true; }
  }
  if (changed) pushPeers();
}

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
  // Seul macOS a une VRAIE encoche physique (ecran interne). Windows/Linux, et tout
  // ecran externe : encoche SIMULEE fine (6px) et discrete -> pas de gros bandeau.
  // br borne par (h - tr) dans notchPath -> tr petit (2) pour laisser l'arrondi du bas.
  const macInternal = process.platform === 'darwin' && display.internal;
  if (!macInternal) {
    return { closedWidth: 140, closedHeight: 6, tr: 2, br: 4, hasNotch: false, simulated: true };
  }
  if (probedGeo) return { ...probedGeo };
  return baseGeometry(display);
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

// ---- Notification "peek" : l'encoche fermee GROSSIT brievement en pilule (sans
// ouvrir la vue complete), pour signaler un fichier recu. La fenetre s'agrandit un
// peu (place pour la forme), le renderer anime la bulle + flash, puis on revient. ----
const NOTIF_MS = 1800;
function setBoundsPeek(n) {
  if (!alive(n) || n.fixed) return; // ecran externe : fenetre deja pleine taille
  const d = n.display;
  const y = process.platform === 'win32' ? d.workArea.y : d.bounds.y;
  // Marge : cible +120, le rebond (zeta 0.42) depasse d'~30px -> on prend +185
  // pour ne JAMAIS clipper le depassement de la pilule.
  const w = Math.round(n.geo.closedWidth + 8 + 185);
  const h = 74;
  n.win.setBounds({ x: Math.round(d.bounds.x + d.bounds.width / 2 - w / 2), y, width: w, height: h }, false);
}
function notifyNotch(n) {
  if (!alive(n) || n.state === 'open') return; // deja ouvert : pas de peek
  clearTimeout(n.notifTimer);
  n.notifActive = true;
  setBoundsPeek(n);
  n.win.webContents.send('notch-notify', { on: true });
  n.notifTimer = setTimeout(() => {
    n.notifActive = false;
    n.win.webContents.send('notch-notify', { on: false });
    // Retablit la taille fermee APRES l'animation de retour (evite le clip de la forme).
    setTimeout(() => { if (alive(n) && !n.notifActive && n.state === 'closed') setBounds(n, 'closed'); }, 380);
  }, NOTIF_MS);
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
    win.webContents.send('peers-updated', peerList());
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
  // Identite stable de la machine (persistee une seule fois) : indispensable pour
  // memoriser les appareils de confiance entre deux lancements.
  deviceId = prefsStore.get('airnotchDeviceId');
  if (!deviceId) { deviceId = crypto.randomUUID(); prefsStore.set('airnotchDeviceId', deviceId); }
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

  // Serveur de reception. Le fichier apparait DES LE DEBUT du transfert (placeholder +
  // anneau de progression facon App Store), puis se finalise a la fin.
  const incomingNotch = new Map(); // fileId -> encoche cible (route progression + fin)

  // Debut de transfert : cree le placeholder + declenche la notif "peek".
  const onIncomingStart = ({ fileId, name, size, sender }) => {
    const from = sender && sender.name ? { id: sender.id || '', name: sender.name } : null;
    const n = notchAtCursor();
    if (!alive(n)) return;
    incomingNotch.set(fileId, n);
    n.win.webContents.send('file-incoming', { id: fileId, name, size, from });
    notifyNotch(n); // notif des le debut (avant la fin du telechargement)
  };

  // Progression : met a jour l'anneau du placeholder correspondant.
  const onIncomingProgress = ({ fileId, received, size, failed }) => {
    const n = incomingNotch.get(fileId);
    if (alive(n)) n.win.webContents.send('file-progress', { id: fileId, received, size, failed: !!failed });
    if (failed) incomingNotch.delete(fileId);
  };

  // Fin de transfert : finalise le placeholder (chemin reel + vignette).
  const onFileReceived = (savedPath, name, intent, sender, fileId) => {
    // Fichier relaye depuis le PC pour AirDrop : sur le Mac, on ouvre directement le panneau.
    if (intent === 'airdrop' && process.platform === 'darwin' && airdropPaths([savedPath])) {
      openActiveNotch('home', 1500);
      return;
    }
    const from = sender && sender.name ? { id: sender.id || '', name: sender.name } : null;
    const n = incomingNotch.get(fileId) || notchAtCursor();
    incomingNotch.delete(fileId);
    if (alive(n)) {
      n.win.webContents.send('file-received', { path: savedPath, name, from, id: fileId });
      if (!from) notifyNotch(n); // origine locale (capture/AirDrop) : pas de start -> notif ici
    }
    // Origine LOCALE (capture d'ecran, AirDrop recu) : on partage aussi au reseau.
    // Origine RESEAU (from present) : surtout PAS -> eviterait une boucle infinie.
    if (!from) shareToAllPeers([savedPath]).catch(() => {});
  };
  const tryStartServer = (attempt) => {
    net.startServer(inboxDir, {
      onFile: onFileReceived,
      onStart: onIncomingStart,
      onProgress: onIncomingProgress,
      onClear: () => clearLibrary(false),
    }, authorizeIncoming).catch((err) => {
      console.warn(`[net] serveur indisponible (${err.code || err.message}), tentative ${attempt}/5`);
      if (attempt < 5) setTimeout(() => tryStartServer(attempt + 1), 3000);
    });
  };
  tryStartServer(1);

  detectForm();
  net.startDiscovery(selfProfile, (ip, data) => {
    if (!ip) return;
    const visibility = prefsStore ? prefsStore.get('airnotchVisibility') : 'open';
    const myGroup = pairGroup();
    // Mode prive : on n'affiche QUE les appareils qui partagent notre code.
    if (visibility === 'private') {
      if (!myGroup || data.group !== myGroup) {
        if (peers.delete(ip)) pushPeers();
        return;
      }
    }
    const mine = !!(data.group && data.group === myGroup);
    const prev = peers.get(ip);
    peers.set(ip, {
      ip, id: data.id, host: data.host, name: data.name || data.host,
      os: data.os || 'win', form: data.form || 'desktop', group: data.group || '', mine,
      lastSeen: Date.now(),
    });
    // Ne rediffuse que si la composition visible a change (evite le spam a 3 s).
    if (!prev || prev.name !== data.name || prev.mine !== mine || prev.os !== data.os || prev.form !== data.form) {
      pushPeers();
    }
  });
  setInterval(expirePeers, 3000);

  // Reception AirDrop -> ajoute au shelf (le fichier reste dans ~/Downloads).
  startAirdropWatch((airdropPath) => {
    if (!prefsStore || prefsStore.get('airdropToShelf')) onFileReceived(airdropPath, path.basename(airdropPath));
  });

  // Captures d'ecran -> etagere (comme AirDrop).
  startScreenshotWatch((shotPath) => {
    if (!prefsStore || prefsStore.get('screenshotToShelf')) onFileReceived(shotPath, path.basename(shotPath));
  });

  // Media / HUD / calendrier : helpers 100% macOS (AppleScript, CoreAudio, EventKit).
  // Sur Windows on NE les lance PAS (osascript/helpers absents -> echecs en boucle) :
  // seule la bibliotheque de fichiers est exposee.
  if (process.platform === 'darwin') {
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
  }

  // Verification de mise a jour au demarrage (toutes plateformes) : notification
  // cliquable si une version plus recente existe.
  if ((!prefsStore || prefsStore.get('autoCheckUpdates')) && updater.hasToken()) {
    setTimeout(() => { notifyIfUpdate(); }, 8000);
  }

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

// Envoie chaque fichier vers chaque ip cible. Un fileId partage par fichier permet au
// destinataire de correler debut/progression/fin (anneau de telechargement).
async function sendToTargets(paths, targetIps, intent) {
  const identity = selfIdentity();
  const results = [];
  for (const p of paths) {
    const fileId = `f${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    for (const ip of targetIps) {
      try { await net.sendFile(ip, p, { intent, identity, fileId }); results.push({ path: p, ip, ok: true }); }
      catch (err) { results.push({ path: p, ip, ok: false, error: String(err) }); }
    }
  }
  return results;
}

// Bibliotheque commune : vide TOUT localement, et (si propagate) demande a chaque pair
// de se vider aussi. Un vidage RECU du reseau ne se re-propage pas (pas de boucle).
function clearLibrary(propagate) {
  if (shelfStore) { shelfStore.save([]); broadcast('shelf-items', []); }
  if (propagate) for (const p of peers.values()) net.sendClear(p.ip).catch(() => {});
}

// Bibliotheque commune : COPIE un fichier vers TOUS les appareils du reseau (aucune
// selection). Les fichiers RECUS d'un pair ne repassent JAMAIS par ici -> pas de boucle.
async function shareToAllPeers(paths) {
  const ips = Array.from(peers.values()).map((p) => p.ip);
  if (!paths || !paths.length || !ips.length) return { ok: false, error: 'aucun appareil' };
  const results = await sendToTargets(paths, ips);
  return { ok: !results.some((r) => !r.ok), results };
}

// Cibles par defaut du glisser-deposer direct (reglage all | one).
function defaultTargets() {
  const mode = prefsStore ? prefsStore.get('airnotchDefaultSend') : 'all';
  const all = Array.from(peers.values()).map((p) => p.ip);
  if (mode === 'one') {
    const chosen = prefsStore ? prefsStore.get('airnotchDefaultTarget') : '';
    if (chosen && peers.has(chosen)) return [chosen];
    return all.slice(0, 1); // repli : le premier appareil dispo
  }
  return all;
}

ipcMain.handle('send-files', async (_e, paths) => {
  const targets = defaultTargets();
  if (!targets.length) return { ok: false, error: 'Aucun appareil detecte' };
  const results = await sendToTargets(paths, targets);
  return { ok: !results.some((r) => !r.ok), results };
});

// Bibliotheque commune : le renderer signale un ajout LOCAL -> on copie a tous.
ipcMain.handle('share-to-all', async (_e, paths) => shareToAllPeers(paths));

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

// Taille lisible + fiche d'infos d'un fichier recu (qui l'a envoye, taille, date).
function humanSize(bytes) {
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function showFileInfo(filePath, from) {
  let size = ''; let mtime = '';
  try {
    const st = fs.statSync(filePath);
    size = humanSize(st.size);
    mtime = st.mtime.toLocaleString('fr-FR');
  } catch (_) {}
  try { app.focus({ steal: true }); } catch (_) {}
  dialog.showMessageBox({
    type: 'info',
    message: path.basename(filePath),
    detail: [
      from && from.name ? `Envoye par : ${from.name}` : null,
      size ? `Taille : ${size}` : null,
      mtime ? `Recu le : ${mtime}` : null,
      `Emplacement : ${filePath}`,
    ].filter(Boolean).join('\n'),
    buttons: ['OK', 'Afficher dans le Finder'],
    defaultId: 0,
    cancelId: 0,
  }).then((r) => { if (r.response === 1) shell.showItemInFolder(filePath); }).catch(() => {});
}

// Menu contextuel d'items du shelf (façon ShelfItemViewModel.swift, multi-selection).
ipcMain.on('item-menu', (e, payload) => {
  preventClose = true;
  const paths = payload.paths || [];
  const from = payload.from || null;
  const suffix = paths.length > 1 ? ` (${paths.length})` : '';
  const send = (action) => e.sender.send('menu-action', { action, paths });
  const template = [];
  // Fichier recu d'un autre appareil : qui l'a envoye (clic -> fiche d'infos).
  if (from && from.name && paths.length === 1) {
    template.push(
      { label: `Envoye par ${from.name}`, click: () => showFileInfo(paths[0], from) },
      { type: 'separator' },
    );
  }
  template.push(
    { label: 'Ouvrir' + suffix, click: () => send('open') },
    {
      label: process.platform === 'darwin' ? 'Afficher dans le Finder' : "Afficher dans l'Explorateur",
      click: () => send('reveal'),
    },
    { type: 'separator' },
    { label: (peers.size ? `Partager sur le réseau (${peers.size})` : 'Partager sur le réseau') + suffix, enabled: peers.size > 0, click: () => send('send-peer') },
  );
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
  const mac = macPeer();
  if (!mac || !paths || !paths.length) return;
  const identity = selfIdentity();
  paths.forEach((p) => net.sendFile(mac.ip, p, { intent: 'airdrop', identity }).catch((err) => console.warn('relais AirDrop echoue:', err.message)));
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
    { label: peers.size ? `Appareils : ${peers.size}` : 'Appareils : aucun', enabled: false },
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
  peers: peerList(),
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
  // Changement de visibilite / code : on repart d'une table vierge, elle se remplit
  // en <3 s avec le filtrage a jour.
  if (key === 'airnotchVisibility' || key === 'airnotchPairCode') { peers.clear(); pushPeers(); }
  // Les encoches (renderer) suivent les autres prefs en direct via ce broadcast.
  broadcast('prefs', getPrefs());
});

ipcMain.on('clear-shelf', () => clearLibrary(true));
// Vidage depuis la bulle (bouton/menu) : vide localement + propage a tous les appareils.
ipcMain.on('library-clear', () => clearLibrary(true));
ipcMain.on('open-inbox', () => shell.openPath(inboxDir));
ipcMain.on('open-external', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url); });
// ---- Mise a jour integree (Releases GitHub, repo prive + token lecture seule) ----
let updating = false;
function setUpdateProgress(p) {
  for (const n of notches) { if (alive(n)) try { n.win.setProgressBar(p); } catch (_) {} }
}
async function runUpdateFlow(interactive) {
  if (updating) return;
  if (!updater.hasToken()) {
    if (interactive) dialog.showMessageBox({ type: 'info', message: 'Mise a jour indisponible',
      detail: "Cette version n'a pas de token de mise a jour integre." });
    return;
  }
  let info;
  try { info = await updater.checkForUpdate(); }
  catch (err) {
    if (interactive) dialog.showMessageBox({ type: 'warning', message: 'Verification impossible', detail: String(err.message) });
    return;
  }
  if (!info.available) {
    if (interactive) dialog.showMessageBox({ type: 'info', message: 'NotchZFX est a jour', detail: 'Version ' + info.current + ' — c\'est la derniere.' });
    return;
  }
  const r = await dialog.showMessageBox({
    type: 'info', buttons: ['Plus tard', 'Installer et redemarrer'], defaultId: 1, cancelId: 0,
    message: `Mise a jour disponible : ${info.latest}`,
    detail: `Tu as la ${info.current}. Telecharger la ${info.latest} (${(info.asset.size / 1048576).toFixed(0)} Mo), l'installer et redemarrer ?`,
  });
  if (r.response !== 1) return;
  updating = true;
  try {
    const zip = path.join(os.tmpdir(), info.asset.name);
    setUpdateProgress(0.02);
    await updater.downloadAsset(info.asset.id, zip, (p) => setUpdateProgress(Math.max(0.02, p)));
    setUpdateProgress(0.999);
    updater.install(zip);           // lance le swapper detache
    setTimeout(() => { app.isQuitting = true; app.quit(); }, 500);
  } catch (err) {
    updating = false;
    setUpdateProgress(-1);
    dialog.showMessageBox({ type: 'error', message: 'Echec de la mise a jour', detail: String(err.message) });
  }
}
// Verification silencieuse au demarrage : notification cliquable si MAJ dispo.
async function notifyIfUpdate() {
  try {
    const info = await updater.checkForUpdate();
    if (!info || !info.available) return;
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: `NotchZFX — mise a jour ${info.latest}`, body: 'Clique pour installer et redemarrer.' });
    n.on('click', () => runUpdateFlow(true));
    n.show();
  } catch (_) { /* hors ligne / token invalide : silencieux */ }
}
ipcMain.handle('check-updates', async () => { await runUpdateFlow(true); return { ok: true }; });

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
