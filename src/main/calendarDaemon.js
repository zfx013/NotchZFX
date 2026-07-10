// Pont vers le helper calendrier natif (calendarHelper.swift).
// Sur macOS : compile le bundle .app s'il manque, puis exec le binaire signe qui
// imprime un JSON (calendriers, listes de rappels, evenements a venir, rappels).
// Le bundle .app + signature ad-hoc + cles d'usage TCC sont NECESSAIRES pour que
// la permission calendrier/rappels soit correctement attribuee par macOS.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Binaire du helper (bundle .app). On l'exec directement : macOS lui donne alors
// l'identite de l'app (via l'Info.plist du bundle), condition pour l'octroi TCC.
const HELPER_BIN = path.join(__dirname, 'CalendarHelper.app', 'Contents', 'MacOS', 'CalendarHelper');
const BUILD_SCRIPT = path.join(__dirname, 'build-calendar.sh');

// Reponse vide (utilisee en cas d'echec ou hors macOS).
const EMPTY = {
  authorized: false,
  remindersAuthorized: false,
  calendars: [],
  reminderLists: [],
  events: [],
  reminders: [],
};

// Compile le bundle via build-calendar.sh s'il manque (comme dragDaemon).
// Renvoie une Promise resolue quand le binaire existe (ou rejetee si echec).
function buildCalendarHelper() {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      reject(new Error('calendrier: macOS uniquement'));
      return;
    }
    if (fs.existsSync(HELPER_BIN)) {
      resolve(HELPER_BIN);
      return;
    }
    const child = spawn('bash', [BUILD_SCRIPT], { stdio: 'ignore' });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0 && fs.existsSync(HELPER_BIN)) {
        resolve(HELPER_BIN);
      } else {
        reject(new Error('echec compilation CalendarHelper (code ' + code + ')'));
      }
    });
  });
}

// S'assure que le helper est build, le lance avec <days>, lit stdout, parse le
// JSON et renvoie l'objet. Timeout ~8s. En cas d'echec -> objet vide (EMPTY).
function getCalendar(days = 7) {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ ...EMPTY });
      return;
    }

    buildCalendarHelper()
      .then(() => {
        let child;
        let done = false;
        let out = '';

        const finish = (obj) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { if (child && !child.killed) child.kill(); } catch (_) {}
          resolve(obj);
        };

        const timer = setTimeout(() => finish({ ...EMPTY }), 8000);

        try {
          child = spawn(HELPER_BIN, [String(days)], { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (_) {
          finish({ ...EMPTY });
          return;
        }

        child.stdout.on('data', (d) => { out += d.toString(); });
        child.on('error', () => finish({ ...EMPTY }));
        child.on('exit', () => {
          try {
            const parsed = JSON.parse(out.trim());
            finish(parsed && typeof parsed === 'object' ? parsed : { ...EMPTY });
          } catch (_) {
            finish({ ...EMPTY });
          }
        });
      })
      .catch(() => resolve({ ...EMPTY }));
  });
}

module.exports = { getCalendar, buildCalendarHelper };
