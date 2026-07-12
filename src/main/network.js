// Reseau local : serveur HTTP en streaming pour les fichiers + decouverte UDP du pair.
const express = require('express');
const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILE_PORT = 8787;       // reception des fichiers
const DISCOVERY_PORT = 8788;  // decouverte automatique du pair

// Assainit un nom de fichier pour qu'il soit valide sur macOS ET Windows.
function sanitizeName(name) {
  const clean = name
    .replace(/[<>:"\/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '');
  return clean || `fichier-${Date.now()}`;
}

// Serveur de reception : le corps de la requete est STREAME vers le disque
// (aucun chargement en memoire, taille de fichier illimitee).
// onFile(savedPath, name, intent) est appele a chaque fichier ACCEPTE.
// authorize(meta) -> Promise<bool> : autorise (ou non) AVANT de lire le corps,
// pour rejeter un inconnu sans meme telecharger le fichier (anti remplissage disque).
function startServer(inboxDir, handlers, authorize) {
  // handlers = { onFile, onStart, onProgress, onClear } (ou une fonction = onFile seul).
  const h = typeof handlers === 'function' ? { onFile: handlers } : (handlers || {});
  const app = express();

  app.get('/ping', (_req, res) => res.json({ app: 'notchdrop', host: os.hostname() }));

  // Bibliotheque commune : un pair demande de TOUT vider -> on relaie a l'app locale.
  app.post('/clear', (req, res) => {
    try { if (h.onClear) h.onClear(); } catch (_) {}
    res.json({ ok: true });
    req.resume();
  });

  app.post('/drop', async (req, res) => {
    const intent = req.get('x-intent') || null; // ex. 'airdrop' -> relais AirDrop cote Mac
    let rawName = `fichier-${Date.now()}`;
    let devName = '';
    try { rawName = decodeURIComponent(req.get('x-filename') || rawName); } catch (_) {}
    try { devName = decodeURIComponent(req.get('x-device-name') || ''); } catch (_) {}
    const fileId = req.get('x-file-id') || `f${Date.now()}-${Math.round(process.hrtime()[1] % 1e6)}`;
    const size = Number(req.get('content-length')) || 0;
    const meta = {
      deviceId: req.get('x-device-id') || '',
      name: devName,
      group: req.get('x-group') || '',
      filename: sanitizeName(path.basename(rawName)),
      intent,
    };
    // Controle d'acces (modele AirDrop) : peut ouvrir une confirmation (async).
    let allowed = true;
    try { allowed = authorize ? await authorize(meta) : true; } catch (_) { allowed = false; }
    if (!allowed) {
      res.status(403).json({ ok: false, error: 'Refuse par le destinataire' });
      req.resume(); // vide le corps eventuel
      return;
    }

    let dest;
    try {
      dest = uniquePath(path.join(inboxDir, meta.filename));
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err) });
    }
    const sender = { id: meta.deviceId, name: meta.name };
    // Fichier relaye pour AirDrop (Mac) : pas de placeholder/progression, juste le resultat.
    if (intent !== 'airdrop' && h.onStart) {
      try { h.onStart({ fileId, name: meta.filename, size, sender }); } catch (_) {}
    }
    const ws = fs.createWriteStream(dest);
    let failed = false;
    const abort = (code, err) => {
      if (failed) return;
      failed = true;
      ws.destroy();
      fs.unlink(dest, () => {});
      if (intent !== 'airdrop' && h.onProgress) { try { h.onProgress({ fileId, received: 0, size, failed: true }); } catch (_) {} }
      if (code) res.status(code).json({ ok: false, error: String(err) });
    };
    // Progression : on compte les octets recus (throttle ~120 ms) pour l'anneau.
    let received = 0; let lastEmit = 0;
    if (intent !== 'airdrop' && h.onProgress && size > 0) {
      req.on('data', (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastEmit >= 120 || received >= size) {
          lastEmit = now;
          try { h.onProgress({ fileId, received, size }); } catch (_) {}
        }
      });
    }
    req.on('aborted', () => abort(0));
    req.on('error', (err) => abort(0, err));
    ws.on('error', (err) => abort(500, err));
    ws.on('finish', () => {
      if (failed) return;
      h.onFile(dest, path.basename(dest), intent, sender, fileId);
      res.json({ ok: true });
    });
    req.pipe(ws);
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(FILE_PORT, () => {
      console.log(`[net] serveur de fichiers sur le port ${FILE_PORT}`);
      resolve(server);
    });
    server.on('error', (err) => reject(err)); // ex. EADDRINUSE
  });
}

// Envoi d'un fichier en STREAMING (http.request + createReadStream).
// opts : { intent?, identity? } ; identity = { id, name, group } de l'expediteur
// (permet au destinataire d'authentifier / afficher qui envoie).
function sendFile(peerIp, filePath, opts = {}) {
  const { intent, identity, fileId } = opts;
  return new Promise((resolve, reject) => {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      return reject(err);
    }
    const req = http.request({
      host: peerIp,
      port: FILE_PORT,
      path: '/drop',
      method: 'POST',
      headers: Object.assign({
        'content-type': 'application/octet-stream',
        'content-length': stat.size,
        'x-filename': encodeURIComponent(path.basename(filePath)),
        'x-file-id': fileId || '',
      },
      intent ? { 'x-intent': intent } : {},
      identity ? {
        'x-device-id': identity.id || '',
        'x-device-name': encodeURIComponent(identity.name || ''),
        'x-group': identity.group || '',
      } : {}),
      timeout: 60000, // laisse le temps d'accepter une confirmation cote destinataire
    }, (res) => {
      res.resume();
      if (res.statusCode === 200) resolve(true);
      else reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    const rs = fs.createReadStream(filePath);
    rs.on('error', (err) => { req.destroy(); reject(err); });
    rs.pipe(req);
  });
}

// Bibliotheque commune : demande a un pair de TOUT vider (POST /clear, sans corps).
function sendClear(peerIp) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: peerIp, port: FILE_PORT, path: '/clear', method: 'POST', timeout: 5000 }, (res) => {
      res.resume();
      res.statusCode === 200 ? resolve(true) : reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

// Toutes les IPv4 locales non-internes, avec leur adresse de broadcast de sous-reseau.
function localInterfaces() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address.split('.').map(Number);
      const mask = (iface.netmask || '255.255.255.0').split('.').map(Number);
      const bcast = ip.map((oct, i) => (oct & mask[i]) | (~mask[i] & 255)).join('.');
      out.push({ address: iface.address, broadcast: bcast });
    }
  }
  return out;
}

function localIPv4() {
  const list = localInterfaces();
  return list.length ? list[0].address : '127.0.0.1';
}

// Decouverte : annonce periodique en broadcast SUR CHAQUE interface (Windows
// n'emet 255.255.255.255 que sur une seule interface sinon), et identification
// du pair par l'ADRESSE SOURCE du datagramme (fiable), pas par l'IP annoncee.
//
// getInfo() renvoie le profil courant a annoncer (relu a chaque emission, pour
// suivre en direct les changements de reglages : nom, groupe d'appairage...) :
//   { id, host, name, os, form, group }
// onPeer(ip, data) est appele a chaque annonce recue d'un AUTRE appareil, avec
// le profil complet decode.
function startDiscovery(getInfo, onPeer) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.app !== 'notchdrop') return;
      if (data.id && data.id === getInfo().id) return; // ignore ses propres annonces
      onPeer(rinfo.address, data);
    } catch (_) { /* paquet non pertinent */ }
  });

  socket.on('error', (err) => console.warn('[net] decouverte UDP:', err.message));

  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true);
    const announce = () => {
      const payload = JSON.stringify(Object.assign({ app: 'notchdrop' }, getInfo()));
      for (const iface of localInterfaces()) {
        socket.send(payload, DISCOVERY_PORT, iface.broadcast, () => {});
      }
      socket.send(payload, DISCOVERY_PORT, '255.255.255.255', () => {});
    };
    announce();
    setInterval(announce, 3000);
  });

  return socket;
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  let i = 1;
  let candidate;
  do {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i++;
  } while (fs.existsSync(candidate));
  return candidate;
}

module.exports = { startServer, sendFile, sendClear, startDiscovery, localIPv4, sanitizeName, uniquePath, FILE_PORT };
