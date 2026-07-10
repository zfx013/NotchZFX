// Pont vers le moniteur de HUD natif (hudMonitor.swift).
// Sur macOS : compile le bundle a la volee s'il manque, lance le binaire en tache
// de fond et ecoute ses evenements VOL / BRIGHT sur stdout. Sur les autres OS :
// pas de moniteur (le HUD custom reste inactif).
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Binaire de l'app moniteur (bundle .app). On l'exec directement : macOS lui
// donne l'identite de l'app via l'Info.plist du bundle (agent accessoire).
const HUD_BIN = path.join(__dirname, 'HUDMonitor.app', 'Contents', 'MacOS', 'HUDMonitor');
const BUILD_SCRIPT = path.join(__dirname, 'build-hud.sh');

// startHudMonitor({ onVolume, onBrightness, onLog }) -> { kill() }
//   onVolume(volumeFloat 0..1, mutedBool)  a chaque changement de volume/muet
//   onBrightness(brightnessFloat 0..1)      a chaque changement de luminosite
//   onLog(str)                              lignes de stderr (diagnostic)
function startHudMonitor({ onVolume, onBrightness, onLog } = {}) {
  if (process.platform !== 'darwin') return { kill() {} };

  // Compile le bundle a la volee s'il manque (1re exec, ou source modifiee).
  if (!fs.existsSync(HUD_BIN)) {
    try { spawnSync('bash', [BUILD_SCRIPT], { stdio: 'ignore' }); } catch (_) {}
  }

  let child = null;
  let killed = false;

  const log = (s) => { if (onLog) onLog(s); else console.warn('[hudMonitor]', s); };

  function handleLine(line) {
    if (line.startsWith('VOL\t')) {
      // VOL \t <volume 0..1> \t <muted 0|1>
      const parts = line.split('\t');
      const volume = parseFloat(parts[1]);
      const muted = parts[2] === '1';
      if (!Number.isNaN(volume) && onVolume) onVolume(volume, muted);
    } else if (line.startsWith('BRIGHT\t')) {
      // BRIGHT \t <luminosite 0..1>
      const parts = line.split('\t');
      const brightness = parseFloat(parts[1]);
      if (!Number.isNaN(brightness) && onBrightness) onBrightness(brightness);
    }
  }

  function spawnChild() {
    if (killed) return;
    try {
      child = spawn(HUD_BIN, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      log('indisponible: ' + err.message);
      return;
    }

    let buf = '';
    child.stdout.on('data', (data) => {
      buf += data.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trimEnd();
        buf = buf.slice(idx + 1);
        if (line) handleLine(line);
      }
    });

    child.stderr.on('data', (d) => {
      d.toString().split('\n').forEach((line) => {
        const s = line.trim();
        if (s) log(s);
      });
    });

    child.on('error', (err) => log('indisponible: ' + err.message));

    // Relance simple si le process meurt (sauf arret volontaire).
    child.on('exit', () => {
      child = null;
      if (!killed) setTimeout(spawnChild, 500);
    });
  }

  spawnChild();

  return {
    kill() {
      killed = true;
      if (child) { try { child.kill(); } catch (_) {} child = null; }
    },
  };
}

module.exports = { startHudMonitor };
