// Pont vers l'attrapeur de drop natif (dragMonitor.swift).
// Sur macOS : lance `swift dragMonitor.swift` en tache de fond et ecoute ses
// evenements START / END / DROP sur stdout. Sur les autres OS : pas de detecteur
// global (on retombe sur le drop DOM d'Electron).
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Binaire de l'app attrapeuse (bundle .app). On l'exec directement : macOS lui
// donne alors l'identite de l'app (via l'Info.plist du bundle), condition pour
// qu'elle soit une cible de drag & drop valide (l'interpreteur swift ne l'est pas).
const CATCHER_BIN = path.join(__dirname, 'DragCatcher.app', 'Contents', 'MacOS', 'DragCatcher');
const BUILD_SCRIPT = path.join(__dirname, 'build-catcher.sh');

function startDragMonitor({ onStart, onEnd, onDrop, onLog }) {
  if (process.platform !== 'darwin') return null;

  // Compile le bundle a la volee s'il manque (1re exec, ou source modifiee).
  if (!fs.existsSync(CATCHER_BIN)) {
    try { spawnSync('bash', [BUILD_SCRIPT], { stdio: 'ignore' }); } catch (_) {}
  }

  let child;
  try {
    // stdin en pipe : Electron peut envoyer des commandes (ex. AIRDROP).
    child = spawn(CATCHER_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (_) {
    return null;
  }

  let buf = '';
  child.stdout.on('data', (data) => {
    buf += data.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trimEnd();
      buf = buf.slice(idx + 1);
      if (line === 'START') {
        onStart && onStart();
      } else if (line === 'END') {
        onEnd && onEnd();
      } else if (line.startsWith('DROP\t')) {
        // DROP \t x \t y \t base64(JSON paths)
        const parts = line.split('\t');
        const x = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        let paths = [];
        try { paths = JSON.parse(Buffer.from(parts[3] || '', 'base64').toString('utf8')); } catch (_) {}
        onDrop && onDrop(Array.isArray(paths) ? paths : [], { x, y });
      }
    }
  });

  child.stderr.on('data', (d) => {
    d.toString().split('\n').forEach((line) => {
      const s = line.trim();
      if (!s) return;
      if (onLog) onLog(s); else console.warn('[dragMonitor]', s);
    });
  });
  child.on('error', (err) => console.warn('[dragMonitor] indisponible:', err.message));

  return child;
}

module.exports = { startDragMonitor };
