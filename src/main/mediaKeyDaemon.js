// Pont vers l'intercepteur de touches media (mediaKeys.swift).
// Lance le helper, ecoute son statut sur stdout, et le relance. Le helper CONSOMME
// les touches volume/luminosite pour empecher la jauge native (OSD) de macOS 26 (qui
// est dessinee in-process par ControlCenter et ne peut donc pas etre tuee).
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MK_BIN = path.join(__dirname, 'MediaKeyInterceptor.app', 'Contents', 'MacOS', 'MediaKeyInterceptor');
const BUILD_SCRIPT = path.join(__dirname, 'build-mediakeys.sh');

// startMediaKeys({ onStatus, onKey, onLog, onScreenOff, onSpecial, f6, offCode }) -> { kill() }
//   onStatus('ok' | 'need-accessibility')  etat de l'interception
//   onKey(code)                            touche media appliquee (0/1 vol, 7 mute, 2/3 lum)
//   onScreenOff()                          F6 (ou code configure) captee -> ecran eteint
//   onSpecial(code)                        touche-fonction speciale vue (decouverte du code)
//   f6=true                                active la capture de F6 (env MK_F6)
//   offCode                                code NX_SYSDEFINED a intercepter (env MK_OFFCODE)
function startMediaKeys({ onStatus, onKey, onLog, onScreenOff, onSpecial, f6, offCode } = {}) {
  if (process.platform !== 'darwin') return { kill() {} };
  if (!fs.existsSync(MK_BIN)) {
    try { spawnSync('bash', [BUILD_SCRIPT], { stdio: 'ignore' }); } catch (_) {}
  }

  let child = null;
  let killed = false;
  let firstSpawn = true;
  let lastStatus = null;
  const log = (s) => { if (onLog) onLog(s); };

  function handleLine(line) {
    if (line === 'TAP_OK') { lastStatus = 'ok'; if (onStatus) onStatus('ok'); }
    else if (line === 'NEED_ACCESSIBILITY' || line === 'TAP_FAIL') {
      lastStatus = 'need'; if (onStatus) onStatus('need-accessibility');
    } else if (line.startsWith('KEY ')) {
      const c = parseInt(line.slice(4), 10);
      if (!Number.isNaN(c) && onKey) onKey(c);
    } else if (line === 'SCREENOFF') {
      if (onScreenOff) onScreenOff();
    } else if (line.startsWith('SPECIAL ')) {
      const c = parseInt(line.slice(8), 10);
      if (!Number.isNaN(c) && onSpecial) onSpecial(c);
    }
  }

  function spawnChild() {
    if (killed) return;
    // Prompt Accessibilite uniquement au tout premier lancement.
    const env = Object.assign({}, process.env,
      firstSpawn ? { MK_PROMPT: '1' } : {},
      f6 ? { MK_F6: '1' } : {},
      (offCode != null && offCode >= 0) ? { MK_OFFCODE: String(offCode) } : {});
    firstSpawn = false;
    try {
      child = spawn(MK_BIN, [], { stdio: ['ignore', 'pipe', 'pipe'], env });
    } catch (err) { log('indisponible: ' + err.message); return; }

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (l) handleLine(l);
      }
    });
    child.stderr.on('data', (d) => { const s = String(d).trim(); if (s) log(s); });
    child.on('error', (err) => log('err: ' + err.message));
    child.on('exit', () => {
      child = null;
      // Respawn : rapide si actif, plus lent si la permission manque (l'utilisateur
      // doit l'accorder ; on reprend automatiquement des qu'elle l'est).
      if (!killed) setTimeout(spawnChild, lastStatus === 'need' ? 6000 : 1000);
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

module.exports = { startMediaKeys };
