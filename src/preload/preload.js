const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('notch', {
  // Etat / geometrie pilotes par le process principal
  onNotchState: (cb) => ipcRenderer.on('notch-state', (_e, s) => cb(s)),
  onSwitchTab: (cb) => ipcRenderer.on('switch-tab', (_e, t) => cb(t)),
  onGeometry: (cb) => ipcRenderer.on('geometry', (_e, g) => cb(g)),
  onPrefs: (cb) => ipcRenderer.on('prefs', (_e, p) => cb(p)),
  openNotch: (tab) => ipcRenderer.send('open-notch', tab || null),
  openSettings: () => ipcRenderer.send('open-settings'),
  setPreventClose: (on) => ipcRenderer.send('set-prevent-close', on),

  // Media (now playing via AppleScript cote main)
  onMedia: (cb) => ipcRenderer.on('media', (_e, m) => cb(m)),
  mediaControl: (action) => ipcRenderer.send('media-control', action),
  mediaSeek: (posSec) => ipcRenderer.send('media-seek', posSec),
  // HUD volume / luminosite
  onHud: (cb) => ipcRenderer.on('hud', (_e, h) => cb(h)),
  // Calendrier
  onCalendar: (cb) => ipcRenderer.on('calendar', (_e, c) => cb(c)),

  // Fichiers
  sendFiles: (paths) => ipcRenderer.invoke('send-files', paths),
  onFileReceived: (cb) => ipcRenderer.on('file-received', (_e, d) => cb(d)),
  onExternalDrop: (cb) => ipcRenderer.on('external-drop', (_e, d) => cb(d)),
  getThumb: (p) => ipcRenderer.invoke('get-thumb', p),
  startDrag: (p) => ipcRenderer.send('start-drag', p),
  openFile: (p) => ipcRenderer.send('open-file', p),
  revealFile: (p) => ipcRenderer.send('reveal-file', p),

  // Shelf : persistance
  onShelfItems: (cb) => ipcRenderer.on('shelf-items', (_e, items) => cb(items)),
  saveShelf: (items) => ipcRenderer.send('shelf-save', items),

  // Menus natifs
  popupItemMenu: (payload) => ipcRenderer.send('item-menu', payload),
  popupPanelMenu: () => ipcRenderer.send('panel-menu'),
  popupGearMenu: () => ipcRenderer.send('gear-menu'),
  onMenuAction: (cb) => ipcRenderer.on('menu-action', (_e, d) => cb(d)),

  // Partage systeme (AirDrop) + selecteur de fichiers
  shareMenu: (paths, x, y) => ipcRenderer.send('share-menu', { paths, x, y }),
  airdrop: (paths) => ipcRenderer.send('airdrop', { paths }),
  airdropViaPeer: (paths) => ipcRenderer.send('airdrop-via-peer', { paths }),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  saveText: (text) => ipcRenderer.invoke('save-text', text),

  platform: process.platform,

  // Reseau
  onPeerUpdated: (cb) => ipcRenderer.on('peer-updated', (_e, d) => cb(d)),
  onSelfInfo: (cb) => ipcRenderer.on('self-info', (_e, d) => cb(d)),

  quit: () => ipcRenderer.send('quit-app'),
  dbg: (msg) => ipcRenderer.send('dbg', msg),

  // Vrai chemin disque d'un fichier glisse
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (_) { return file.path || null; }
  },
});

// API dediee a la fenetre Parametres.
contextBridge.exposeInMainWorld('settings', {
  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  setPref: (key, value) => ipcRenderer.send('set-pref', { key, value }),
  getInfo: () => ipcRenderer.invoke('settings-info'),
  clearShelf: () => ipcRenderer.send('clear-shelf'),
  openInbox: () => ipcRenderer.send('open-inbox'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  quitApp: () => ipcRenderer.send('quit-app'),
  onPeer: (cb) => ipcRenderer.on('peer-updated', (_e, d) => cb(d)),
});
