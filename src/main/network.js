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
// onFile(savedPath, name) est appele a chaque fichier recu.
function startServer(inboxDir, onFile) {
  const app = express();

  app.get('/ping', (_req, res) => res.json({ app: 'notchdrop', host: os.hostname() }));

  app.post('/drop', (req, res) => {
    let dest;
    const intent = req.get('x-intent') || null; // ex. 'airdrop' -> relais AirDrop cote Mac
    try {
      const rawName = decodeURIComponent(req.get('x-filename') || `fichier-${Date.now()}`);
      dest = uniquePath(path.join(inboxDir, sanitizeName(path.basename(rawName))));
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err) });
    }
    const ws = fs.createWriteStream(dest);
    let failed = false;
    const abort = (code, err) => {
      if (failed) return;
      failed = true;
      ws.destroy();
      fs.unlink(dest, () => {});
      if (code) res.status(code).json({ ok: false, error: String(err) });
    };
    req.on('aborted', () => abort(0));
    req.on('error', (err) => abort(0, err));
    ws.on('error', (err) => abort(500, err));
    ws.on('finish', () => {
      if (failed) return;
      onFile(dest, path.basename(dest), intent);
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
// intent (optionnel) : 'airdrop' -> le pair (Mac) relaiera vers AirDrop a l'arrivee.
function sendFile(peerIp, filePath, intent) {
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
      }, intent ? { 'x-intent': intent } : {}),
      timeout: 15000, // inactivite socket (le timer se reamorce a chaque octet)
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
function startDiscovery(selfId, onPeer) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.app !== 'notchdrop') return;
      if (data.id === selfId) return; // ignore ses propres annonces
      onPeer(rinfo.address, data.host);
    } catch (_) { /* paquet non pertinent */ }
  });

  socket.on('error', (err) => console.warn('[net] decouverte UDP:', err.message));

  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true);
    const announce = () => {
      const payload = JSON.stringify({ app: 'notchdrop', id: selfId, host: os.hostname() });
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

module.exports = { startServer, sendFile, startDiscovery, localIPv4, sanitizeName, uniquePath, FILE_PORT };
