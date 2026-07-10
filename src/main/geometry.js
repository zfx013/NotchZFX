// Geometrie de l'encoche, calquee sur boring.notch/sizing/matters.swift.
//
// - Largeur physique de l'encoche : screen.width - auxiliaryTopLeftArea - auxiliaryTopRightArea + 4
//   (fallback 185 + 4). Electron ne l'expose pas -> sonde Swift optionnelle, sinon fallback.
// - Hauteur fermee : safeAreaInsets.top sur ecran a encoche (mode .matchRealNotchSize),
//   hauteur de barre de menus sinon (mode .matchMenuBar). Approximation Electron :
//   workArea.y - bounds.y (= hauteur de la barre de menus, qui egale l'encoche sur
//   les MacBook a encoche).
const { execFile } = require('child_process');

const FALLBACK_CLOSED_WIDTH = 185;  // matters.swift:42 (fallback, sans le +4 des aires aux.)
const FALLBACK_CLOSED_HEIGHT = 32;  // Constants.swift:91-92

function baseGeometry(display) {
  // La hauteur de barre de menus n'a de sens que sur macOS ; sur Windows un
  // inset haut = barre des taches en haut, PAS une encoche.
  const menuBarH = process.platform === 'darwin'
    ? Math.max(0, Math.round(display.workArea.y - display.bounds.y))
    : 0;
  const hasTopInset = menuBarH > 0;
  return {
    closedWidth: FALLBACK_CLOSED_WIDTH,
    closedHeight: hasTopInset ? menuBarH : FALLBACK_CLOSED_HEIGHT,
    hasNotch: false, // affine par la sonde Swift sur Mac
    simulated: process.platform !== 'darwin' || !hasTopInset,
  };
}

// Sonde Swift (macOS uniquement) : recupere la vraie largeur d'encoche et safeAreaInsets.top.
// Echoue silencieusement (pas de toolchain Swift, ecran sans encoche...).
function probeMacNotch() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve(null);
    const src = `
import AppKit
if let s = NSScreen.main {
  let l = s.auxiliaryTopLeftArea?.width ?? -1
  let r = s.auxiliaryTopRightArea?.width ?? -1
  print("\\(s.frame.width) \\(l) \\(r) \\(s.safeAreaInsets.top)")
}`;
    execFile('swift', ['-e', src], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(null);
      const parts = String(stdout).trim().split(/\s+/).map(Number);
      if (parts.length !== 4 || parts.some(Number.isNaN)) return resolve(null);
      const [frameW, auxL, auxR, safeTop] = parts;
      if (auxL < 0 || auxR < 0 || safeTop <= 0) return resolve(null); // pas d'encoche physique
      resolve({
        closedWidth: Math.round(frameW - auxL - auxR + 4), // matters.swift:56
        closedHeight: Math.round(safeTop),                 // mode .matchRealNotchSize
        hasNotch: true,
        simulated: false,
      });
    });
  });
}

module.exports = { baseGeometry, probeMacNotch };
