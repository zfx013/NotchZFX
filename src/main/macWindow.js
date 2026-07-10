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
const STATIONARY = 16n;           // 1 << 4
const IGNORES_CYCLE = 64n;        // 1 << 6
const FULLSCREEN_AUX = 256n;      // 1 << 8

function applyStationary(win) {
  if (!win || win.isDestroyed()) return false;
  if (!init()) return false;
  try {
    const view = koffi.decode(win.getNativeWindowHandle(), 'void *');
    if (!view) return false;
    const nsWindow = msgSendPtr(view, sel('window'));
    if (!nsWindow) return false;
    let behavior = BigInt(msgSendGet(nsWindow, sel('collectionBehavior')));
    behavior |= CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULLSCREEN_AUX;
    msgSendSet(nsWindow, sel('setCollectionBehavior:'), behavior);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { applyStationary };
