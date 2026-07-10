// Comportements de fenetre macOS non exposes par Electron, poses via FFI (koffi).
//
// 1) applyStationary(win) : collectionBehavior = CanJoinAllSpaces|Stationary|
//    IgnoresCycle|FullScreenAuxiliary (base utile).
// 2) pinToSpace(win) : LE correctif du "l'encoche disparait pendant le swipe de
//    Bureau". Sur macOS, pendant le swipe 3 doigts, WindowServer APLATIT les espaces
//    "managed" -> la fenetre est cuite dans le snapshot de l'espace sortant et glisse
//    hors ecran. collectionBehavior/level n'y changent RIEN. La solution (celle de
//    Boring Notch : NotchSpaceManager + CGSSpace) est de SORTIR la fenetre du systeme
//    d'espaces managed en creant un Space CGS DEDIE (SkyLight prive) a un niveau
//    absolu tres eleve, toujours affiche, et d'y injecter la fenetre. Ce space ne
//    participe pas a l'animation de swipe -> la fenetre reste peinte au-dessus de tout.
//
// Tout est encapsule dans des try/catch : si koffi/SkyLight indisponible, on degrade.

let ready = false;
let koffi, sel, getClass, msgSendPtr, msgSendGet, msgSendSet, msgSendLong, msgSendBoolCls;
let CGSMainConnectionID, CGSSpaceCreate, CGSSpaceSetAbsoluteLevel, CGSShowSpaces,
  CGSAddWindowsToSpaces, CGSRemoveWindowsFromSpaces, CGSHideSpaces, CGSSpaceDestroy,
  CFNumberCreate, CFArrayCreate;

function init() {
  if (ready) return true;
  if (process.platform !== 'darwin') return false;
  try {
    koffi = require('koffi');
    const objc = koffi.load('/usr/lib/libobjc.A.dylib');
    sel = objc.func('void* sel_registerName(const char*)');
    getClass = objc.func('void* objc_getClass(const char*)');
    msgSendPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
    msgSendGet = objc.func('objc_msgSend', 'uint64', ['void *', 'void *']);
    msgSendSet = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'uint64']);
    msgSendLong = objc.func('objc_msgSend', 'long', ['void *', 'void *']);
    msgSendBoolCls = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *']);

    const sky = koffi.load('/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight');
    CGSMainConnectionID = sky.func('int CGSMainConnectionID(void)');
    CGSSpaceCreate = sky.func('uint64 CGSSpaceCreate(int, int, void*)');
    CGSSpaceSetAbsoluteLevel = sky.func('void CGSSpaceSetAbsoluteLevel(int, uint64, int)');
    CGSShowSpaces = sky.func('void CGSShowSpaces(int, void*)');
    CGSAddWindowsToSpaces = sky.func('void CGSAddWindowsToSpaces(int, void*, void*)');
    CGSRemoveWindowsFromSpaces = sky.func('void CGSRemoveWindowsFromSpaces(int, void*, void*)');
    CGSHideSpaces = sky.func('void CGSHideSpaces(int, void*)');
    CGSSpaceDestroy = sky.func('void CGSSpaceDestroy(int, uint64)');

    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
    CFNumberCreate = cf.func('void* CFNumberCreate(void*, int, void*)');
    CFArrayCreate = cf.func('void* CFArrayCreate(void*, void**, long, void*)');

    ready = true;
    return true;
  } catch (_) {
    koffi = null;
    return false;
  }
}

// NSWindowCollectionBehavior (bits)
const CAN_JOIN_ALL_SPACES = 1n, MOVE_TO_ACTIVE = 2n, MANAGED = 4n, TRANSIENT = 8n,
  STATIONARY = 16n, PARTICIPATES_CYCLE = 32n, IGNORES_CYCLE = 64n, FULLSCREEN_AUX = 256n;

function applyStationary(win) {
  if (!win || win.isDestroyed()) return { applied: false, reason: 'no-win' };
  if (!init()) return { applied: false, reason: 'no-koffi' };
  try {
    const view = koffi.decode(win.getNativeWindowHandle(), 'void *');
    if (!view) return { applied: false, reason: 'no-view' };
    const nsWindow = msgSendPtr(view, sel('window'));
    if (!nsWindow) return { applied: false, reason: 'no-nswindow' };
    const before = BigInt(msgSendGet(nsWindow, sel('collectionBehavior')));
    // Managed/Transient/Stationary sont mutuellement exclusifs : on retire Managed
    // (pose par Electron) avant Stationary, sinon Stationary est ignore.
    let after = before & ~(MANAGED | TRANSIENT | MOVE_TO_ACTIVE | PARTICIPATES_CYCLE);
    after |= CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULLSCREEN_AUX;
    msgSendSet(nsWindow, sel('setCollectionBehavior:'), after);
    return { applied: true, after: after.toString() };
  } catch (e) {
    return { applied: false, reason: e.message };
  }
}

const kCFNumberSInt64Type = 4;
function cfArrayOfU64(nums) {
  const elems = nums.map((n) => {
    const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n));
    return CFNumberCreate(null, kCFNumberSInt64Type, b);
  });
  const arr = koffi.alloc('void *', elems.length);
  elems.forEach((p, i) => koffi.encode(arr, i * 8, 'void *', p));
  return CFArrayCreate(null, arr, elems.length, null);
}

// CGWindowID (windowNumber) de la fenetre Electron.
function windowNumber(win) {
  const h = win.getNativeWindowHandle();
  const obj = koffi.as(h.readBigUInt64LE(0), 'void *');
  const isView = msgSendBoolCls(obj, sel('isKindOfClass:'), getClass('NSView'));
  const nsWin = isView ? msgSendPtr(obj, sel('window')) : obj;
  return Number(msgSendLong(nsWin, sel('windowNumber')));
}

// Cree un Space CGS dedie (hors systeme managed) et y injecte la fenetre.
// Retourne l'ID du space (a passer a unpinFromSpace) ou null.
function pinToSpace(win) {
  if (!win || win.isDestroyed()) return null;
  if (!init()) return null;
  try {
    const wn = windowNumber(win);
    if (!(wn > 0)) return null;
    const cid = CGSMainConnectionID();
    const space = CGSSpaceCreate(cid, 0x1, null);     // flag DOIT valoir 1
    if (!space) return null;
    CGSSpaceSetAbsoluteLevel(cid, space, 2147483647);  // Int32.max : au-dessus de tout (y compris plein ecran)
    CGSShowSpaces(cid, cfArrayOfU64([space]));          // space toujours affiche
    CGSAddWindowsToSpaces(cid, cfArrayOfU64([wn]), cfArrayOfU64([space]));
    return space;
  } catch (_) {
    return null;
  }
}

// Re-injecte la fenetre dans son space (apres un show()/changement d'ecran).
function reinjectSpace(win, space) {
  if (!space || !init() || !win || win.isDestroyed()) return;
  try {
    const wn = windowNumber(win);
    if (wn > 0) CGSAddWindowsToSpaces(CGSMainConnectionID(), cfArrayOfU64([wn]), cfArrayOfU64([space]));
  } catch (_) {}
}

// Detruit le space dedie (obligatoire a la fermeture, sinon fuite WindowServer).
function unpinFromSpace(win, space) {
  if (!space || !init()) return;
  try {
    const cid = CGSMainConnectionID();
    if (win && !win.isDestroyed()) {
      const wn = windowNumber(win);
      if (wn > 0) CGSRemoveWindowsFromSpaces(cid, cfArrayOfU64([wn]), cfArrayOfU64([space]));
    }
    CGSHideSpaces(cid, cfArrayOfU64([space]));
    CGSSpaceDestroy(cid, space);
  } catch (_) {}
}

module.exports = { applyStationary, pinToSpace, reinjectSpace, unpinFromSpace };
