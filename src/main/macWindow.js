// Pose le comportement de fenetre "STATIONARY" sur la NSWindow via FFI (koffi).
//
// Electron n'expose pas NSWindowCollectionBehavior. Or, sans le drapeau
// `.stationary`, une fenetre "visible sur tous les bureaux" GLISSE quand meme avec
// le bureau pendant les transitions (swipe entre Spaces, Mission Control, affichage
// du bureau) -> elle disparait le temps de l'animation. On pose donc directement
//   .canJoinAllSpaces | .stationary | .ignoresCycle | .fullScreenAuxiliary
// sur la NSWindow, ce qui la fige a l'ecran pendant ces animations.
//
// Tout est encapsule dans des try/catch : si koffi/libobjc n'est pas disponible,
// on degrade silencieusement (l'app fonctionne, sans le fix anti-glissement).

let ready = false;
let koffi, sel, msgSendPtr, msgSendGet, msgSendSet;

function init() {
  if (ready) return true;
  if (process.platform !== 'darwin') return false;
  try {
    koffi = require('koffi');
    const objc = koffi.load('/usr/lib/libobjc.A.dylib');
    sel = objc.func('void* sel_registerName(const char*)');
    // Meme symbole objc_msgSend, 3 prototypes selon l'appel.
    msgSendPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);            // [view window]
    msgSendGet = objc.func('objc_msgSend', 'uint64', ['void *', 'void *']);            // [win collectionBehavior]
    msgSendSet = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'uint64']);    // [win setCollectionBehavior:]
    ready = true;
    return true;
  } catch (_) {
    koffi = null;
    return false;
  }
}

// NSWindowCollectionBehavior (bits)
const CAN_JOIN_ALL_SPACES = 1n;   // 1 << 0
const MOVE_TO_ACTIVE = 2n;        // 1 << 1  (exclusif avec stationary : la ferait suivre le bureau actif)
const MANAGED = 4n;               // 1 << 2  (pose par Electron ; EXCLUSIF avec stationary/transient)
const TRANSIENT = 8n;             // 1 << 3  (exclusif avec stationary)
const STATIONARY = 16n;           // 1 << 4
const PARTICIPATES_CYCLE = 32n;   // 1 << 5  (exclusif avec ignoresCycle)
const IGNORES_CYCLE = 64n;        // 1 << 6
const FULLSCREEN_AUX = 256n;      // 1 << 8

function applyStationary(win) {
  if (!win || win.isDestroyed()) return { applied: false, reason: 'no-win' };
  if (!init()) return { applied: false, reason: 'no-koffi' };
  try {
    const view = koffi.decode(win.getNativeWindowHandle(), 'void *');
    if (!view) return { applied: false, reason: 'no-view' };
    const nsWindow = msgSendPtr(view, sel('window'));
    if (!nsWindow) return { applied: false, reason: 'no-nswindow' };
    const before = BigInt(msgSendGet(nsWindow, sel('collectionBehavior')));
    // CRUCIAL : Managed / Transient / Stationary sont MUTUELLEMENT EXCLUSIFS. Electron
    // pose Managed -> tant qu'il est present, Stationary est IGNORE (la fenetre glisse
    // avec le bureau). On retire donc Managed+Transient+MoveToActiveSpace (et
    // ParticipatesInCycle, exclusif d'IgnoresCycle) avant de poser nos drapeaux.
    let after = before & ~(MANAGED | TRANSIENT | MOVE_TO_ACTIVE | PARTICIPATES_CYCLE);
    after |= CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULLSCREEN_AUX;
    msgSendSet(nsWindow, sel('setCollectionBehavior:'), after);
    const verify = BigInt(msgSendGet(nsWindow, sel('collectionBehavior')));
    return { applied: true, before: before.toString(), after: after.toString(), verify: verify.toString(), hasStationary: (verify & STATIONARY) === STATIONARY };
  } catch (e) {
    return { applied: false, reason: e.message };
  }
}

module.exports = { applyStationary };
