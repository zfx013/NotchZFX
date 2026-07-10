// Logique de la fenetre Parametres. Utilise l'API `settings` exposee par le preload.
const api = window.settings;

const TOGGLES = ['removeOnDragOut', 'showExternalNotch', 'externalAnimate', 'launchAtLogin'];

async function init() {
  const prefs = await api.getPrefs();
  for (const key of TOGGLES) {
    const el = document.getElementById(key);
    if (!el) continue;
    el.checked = !!prefs[key];
    el.addEventListener('change', () => api.setPref(key, el.checked));
  }

  document.getElementById('clearShelf').addEventListener('click', () => api.clearShelf());
  document.getElementById('openInbox').addEventListener('click', () => api.openInbox());

  const info = await api.getInfo();
  document.getElementById('selfIp').textContent = info.ip || '—';
  document.getElementById('peerInfo').textContent = info.peer
    ? `${info.peerHost || ''} ${info.peer}`.trim()
    : 'aucun';
}

api.onPeer((d) => {
  document.getElementById('peerInfo').textContent = d && d.ip
    ? `${d.host || ''} ${d.ip}`.trim()
    : 'aucun';
});

init();
