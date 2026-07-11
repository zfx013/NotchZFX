// Comportement de fenetre macOS non expose par Electron, pose via FFI (koffi) :
// collectionBehavior = CanJoinAllSpaces | Stationary | IgnoresCycle | FullScreenAuxiliary.
// C'est la config de base d'un overlay type encoche (visible sur tous les bureaux et
// au-dessus du plein ecran). Sans effet de bord. Degrade en silence si koffi absent.
//
// (Un correctif du "disparait pendant le swipe de Bureau" via un Space CGS dedie
//  SkyLight a ete essaye puis retire : il figeait mal l'encoche — cf. historique git.)

let ready = false;
let koffi, sel, msgSendPtr, msgSendGet, msgSendSet;

function init() {
  if (ready) return true;
  if (process.platform !== 'darwin') return false;
  try {
    koffi = require('koffi');
    const objc = koffi.load('/usr/lib/libobjc.A.dylib');
    sel = objc.func('void* sel_registerName(const char*)');
    msgSendPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
    msgSendGet = objc.func('objc_msgSend', 'uint64', ['void *', 'void *']);
    msgSendSet = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'uint64']);
    ready = true;
    return true;
  } catch (_) {
    koffi = null;
    return false;
  }
}

// NSWindowCollectionBehavior (bits). Managed/Transient/Stationary sont mutuellement
// exclusifs -> on retire Managed (pose par Electron) avant d'ajouter Stationary.
const CAN_JOIN_ALL_SPACES = 1n, MOVE_TO_ACTIVE = 2n, MANAGED = 4n, TRANSIENT = 8n,
  STATIONARY = 16n, PARTICIPATES_CYCLE = 32n, IGNORES_CYCLE = 64n, FULLSCREEN_AUX = 256n;

function applyStationary(win) {
  if (!win || win.isDestroyed()) return false;
  if (!init()) return false;
  try {
    const view = koffi.decode(win.getNativeWindowHandle(), 'void *');
    if (!view) return false;
    const nsWindow = msgSendPtr(view, sel('window'));
    if (!nsWindow) return false;
    const before = BigInt(msgSendGet(nsWindow, sel('collectionBehavior')));
    let after = before & ~(MANAGED | TRANSIENT | MOVE_TO_ACTIVE | PARTICIPATES_CYCLE);
    after |= CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULLSCREEN_AUX;
    msgSendSet(nsWindow, sel('setCollectionBehavior:'), after);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { applyStationary };
