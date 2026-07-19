// Persistance des preferences utilisateur (fenetre Parametres).
// JSON simple, fusionne avec les valeurs par defaut au chargement.
// Reproduit l'ensemble des reglages de Boring Notch + nos ajouts (Sync PC, encoche externe).
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // ---- General ----
  showMenuBarIcon: true,
  launchAtLogin: false,
  showOnAllScreens: true,       // notre multi-ecran
  preferredDisplay: 'auto',
  autoSwitchDisplay: true,
  notchHeightNotchDisplays: 'match',   // match | menubar | custom
  notchHeightNonNotch: 'menubar',      // menubar | matchNotch | custom
  openOnHover: true,
  hapticFeedback: true,
  rememberLastTab: false,
  hoverDelay: 0.3,
  gesturesEnabled: true,
  horizontalGestures: false,
  closeGesture: true,
  gestureSensitivity: 'medium',        // low | medium | high

  // ---- Apparence ----
  alwaysShowTabs: true,
  showSettingsIcon: true,
  coloredSpectrogram: true,
  playerTinting: true,
  albumBlur: true,
  sliderColor: 'white',                // white | accent | album
  useMusicVisualizer: true,
  enableMirror: false,
  mirrorShape: 'square',               // square | circle
  coolFaceAnim: false,

  // ---- Media ----
  musicSource: 'spotify',              // spotify | music | nowplaying
  showMusicLiveActivity: true,
  sneakPeekOnChange: false,
  sneakPeekStyle: 'default',           // default | inline | minimal
  mediaInactivityDelay: 3,
  fullScreenBehavior: 'mediaAppOnly',  // mediaAppOnly | always | never
  mediaControls: ['previous', 'playpause', 'next'],
  showLyrics: false,

  // ---- Calendrier ----
  showCalendar: true,
  hideCompletedReminders: true,
  hideAllDayEvents: false,
  autoScrollNextEvent: true,
  showFullEventTitles: false,
  calendarsDisabled: [],               // ids de calendriers decoches
  remindersDisabled: [],

  // ---- HUDs ----
  replaceSystemHUD: true,
  optionKeyBehaviour: 'openSystemSettings',
  progressBarStyle: 'hierarchical',
  hudGlow: false,
  tintProgressAccent: false,
  hudInOpenNotch: true,
  hudShowPercentOpen: true,
  closedHudStyle: 'default',
  hudShowPercentClosed: false,

  // ---- Batterie ----
  showBatteryIndicator: true,
  showChargingNotifications: true,
  showBatteryPercent: true,
  showChargingIcons: true,

  // ---- Etagere ----
  shelfEnabled: true,
  shelfOpenByDefault: true,
  expandedDragArea: true,
  copyItemsOnDrag: false,
  removeOnDragOut: true,                // glisser un fichier hors de l'encoche -> le retirer de la barre
  removePropagates: true,              // retirer un fichier le retire aussi des appareils appaires
  keepAwake: false,                    // bouton "rester eveille" (caffeinate) memorise
  f6ScreenOff: true,                   // capturer fn+F6 (keycode 97) -> ecran eteint
  f6OffCode: -1,                       // (inutilise : F6 seul/Lune est ingerable par une app, gere par macOS)
  f6Discover: false,                   // mode decouverte de touche (OFF : plus aucun log de touches)
  quickShareService: 'airdrop',        // airdrop | peer

  // ---- Raccourcis ----
  shortcutSneakPeek: 'Shift+Cmd+H',
  shortcutOpenNotch: 'Shift+Cmd+I',

  // ---- Advanced ----
  accentMode: 'system',                // system | custom
  accentColor: '#0A84FF',
  windowShadow: true,
  cornerRadiusResize: true,
  expandHoverZone: true,
  hideTitleBar: true,
  showNotchOnLockScreen: false,
  hideFromScreenRecording: false,

  // ---- A propos ----
  autoCheckUpdates: true,
  autoDownloadUpdates: true,

  // ---- Nos ajouts (Sync PC + encoche externe) ----
  showExternalNotch: true,
  externalAnimate: true,
  airdropToShelf: true,
  screenshotToShelf: true,

  // ---- AirNotch (partage local multi-appareils) ----
  airnotchVisibility: 'open',   // open (tout le monde sur le WiFi) | private (code d'appairage)
  airnotchPairCode: '',         // partage entre TES machines quand visibility = private
  airnotchDeviceName: '',       // nom affiche ('' => nom d'hote de la machine)
  airnotchDefaultSend: 'all',   // glisser-deposer direct : all (tous) | one (un seul)
  airnotchDefaultTarget: '',    // ip de l'appareil cible quand defaultSend = one
  // Reception : bibliotheque commune -> on accepte TOUT appareil du reseau par defaut.
  airnotchAcceptFrom: 'everyone', // everyone | paired (memes appareils) | nobody
  airnotchDeviceId: '',         // identite STABLE de cette machine (generee une fois)
  airnotchTrusted: [],          // [{ id, name }] appareils inconnus explicitement acceptes
};

class PrefsStore {
  constructor(dir) {
    this.file = path.join(dir, 'prefs.json');
    this.data = { ...DEFAULTS };
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object') this.data = { ...DEFAULTS, ...raw };
    } catch (_) {
      this.data = { ...DEFAULTS };
    }
    return this.data;
  }

  get(key) { return this.data[key]; }
  all() { return { ...this.data }; }

  set(key, value) {
    if (!(key in DEFAULTS)) return this.data;
    this.data[key] = value;
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.warn('sauvegarde prefs echouee:', err.message);
    }
    return this.data;
  }
}

module.exports = { PrefsStore, PREF_DEFAULTS: DEFAULTS };
