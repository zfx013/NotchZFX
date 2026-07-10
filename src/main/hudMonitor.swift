// Moniteur de HUD natif (macOS) : detecte les changements de VOLUME de sortie
// et de LUMINOSITE de l'ecran principal, pour qu'Electron affiche un HUD custom
// dans l'encoche (facon HUD systeme d'Apple).
//
// C'est un executable en ligne de commande SANS fenetre ni UI (app accessory).
// Il sonde l'etat toutes les ~120 ms et n'emet une ligne QUE lorsqu'une valeur
// change (au-dela d'un petit seuil, pour eviter le bruit).
//
// Emet sur stdout :
//   VOL\t<0..1>\t<muted 0|1>     le volume de sortie ou l'etat muet a change
//   BRIGHT\t<0..1>               la luminosite de l'ecran principal a change
// (fflush apres chaque ligne). Aucune emission de l'etat initial : uniquement
// sur changement.
import AppKit
import Foundation
import CoreAudio
import CoreGraphics

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

func emit(_ s: String) { print(s); fflush(stdout) }

// Construit un FourCharCode ('vmvc', 'outp', ...) a partir d'une chaine ASCII.
func fourCC(_ s: String) -> UInt32 {
    var result: UInt32 = 0
    for c in s.utf8 { result = (result << 8) | UInt32(c) }
    return result
}

// kAudioHardwareServiceDeviceProperty_VirtualMainVolume ('vmvc') n'est pas
// toujours expose par le module CoreAudio de Swift : on le redefinit a la main.
let kVirtualMainVolumeSelector: AudioObjectPropertySelector = fourCC("vmvc")

// ---------------------------------------------------------------------------
// VOLUME (CoreAudio, sans permission)
// ---------------------------------------------------------------------------

// Recupere l'AudioObjectID du peripherique de sortie par defaut.
func defaultOutputDevice() -> AudioObjectID {
    var deviceID = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &deviceID)
    return status == noErr ? deviceID : AudioObjectID(kAudioObjectUnknown)
}

// Lit (volume 0..1, muet) du peripherique de sortie par defaut, ou nil si echec.
func readVolume() -> (Float, Bool)? {
    let dev = defaultOutputDevice()
    if dev == AudioObjectID(kAudioObjectUnknown) { return nil }

    // Volume principal virtuel (0..1), independant du nombre de canaux.
    var vol: Float32 = 0
    var volSize = UInt32(MemoryLayout<Float32>.size)
    var volAddr = AudioObjectPropertyAddress(
        mSelector: kVirtualMainVolumeSelector,
        mScope: kAudioObjectPropertyScopeOutput,
        mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectHasProperty(dev, &volAddr) else { return nil }
    let vs = AudioObjectGetPropertyData(dev, &volAddr, 0, nil, &volSize, &vol)
    if vs != noErr { return nil }

    // Etat muet (0/1) : peut ne pas exister sur certains peripheriques -> 0.
    var muted: UInt32 = 0
    var muteSize = UInt32(MemoryLayout<UInt32>.size)
    var muteAddr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyMute,
        mScope: kAudioObjectPropertyScopeOutput,
        mElement: kAudioObjectPropertyElementMain)
    if AudioObjectHasProperty(dev, &muteAddr) {
        _ = AudioObjectGetPropertyData(dev, &muteAddr, 0, nil, &muteSize, &muted)
    }

    let clamped = max(0, min(1, vol))
    return (clamped, muted != 0)
}

// ---------------------------------------------------------------------------
// LUMINOSITE (frameworks prives, via dlopen -> pas de lien a la compilation)
// ---------------------------------------------------------------------------

// int DisplayServicesGetBrightness(CGDirectDisplayID display, float *brightness)
typealias DSGetBrightnessFn = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
// double CoreDisplay_Display_GetUserBrightness(CGDirectDisplayID display)
typealias CDGetBrightnessFn = @convention(c) (UInt32) -> Double

// Resout les symboles une seule fois au demarrage (peut echouer -> nil).
let displayServicesGetBrightness: DSGetBrightnessFn? = {
    guard let h = dlopen(
        "/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices",
        RTLD_NOW) else { return nil }
    guard let sym = dlsym(h, "DisplayServicesGetBrightness") else { return nil }
    return unsafeBitCast(sym, to: DSGetBrightnessFn.self)
}()

let coreDisplayGetUserBrightness: CDGetBrightnessFn? = {
    guard let h = dlopen(
        "/System/Library/Frameworks/CoreDisplay.framework/CoreDisplay",
        RTLD_NOW) else { return nil }
    guard let sym = dlsym(h, "CoreDisplay_Display_GetUserBrightness") else { return nil }
    return unsafeBitCast(sym, to: CDGetBrightnessFn.self)
}()

// Lit la luminosite (0..1) de l'ecran principal, ou nil si indisponible
// (ex. moniteur externe sans support DDC, ou frameworks absents).
func readBrightness() -> Float? {
    let display = CGMainDisplayID()

    if let fn = displayServicesGetBrightness {
        var b: Float = 0
        if fn(display, &b) == 0 && b >= 0 && b <= 1 {
            return b
        }
    }
    if let fn = coreDisplayGetUserBrightness {
        let b = fn(display)
        if b.isFinite && b >= 0 && b <= 1 {
            return Float(b)
        }
    }
    return nil
}

// ---------------------------------------------------------------------------
// Boucle de sondage
// ---------------------------------------------------------------------------

final class HudMonitor {
    // Derniers etats connus : nil = pas encore de base (on ne l'emet pas).
    var lastVol: Float?
    var lastMuted: Bool?
    var lastBright: Float?

    let volThreshold: Float = 0.005   // 0.5 %
    let brightThreshold: Float = 0.005

    func start() {
        // Sonde toutes les ~50 ms : detection rapide pour masquer la jauge native
        // avant qu'elle ne clignote (lecture CoreAudio + DisplayServices peu couteuse).
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(timer, forMode: .common)
    }

    func poll() {
        // VOLUME + MUET : on emet si le volume bouge assez OU si le muet change.
        if let (vol, muted) = readVolume() {
            let volChanged = lastVol.map { abs($0 - vol) >= volThreshold } ?? true
            let muteChanged = lastMuted.map { $0 != muted } ?? true
            let hadBaseline = (lastVol != nil)
            lastVol = vol
            lastMuted = muted
            // On ne diffuse pas l'etat initial : uniquement les changements reels.
            if hadBaseline && (volChanged || muteChanged) {
                emit("VOL\t\(vol)\t\(muted ? 1 : 0)")
            }
        }

        // LUMINOSITE : degrade proprement si indisponible (on n'emet rien).
        if let bright = readBrightness() {
            let changed = lastBright.map { abs($0 - bright) >= brightThreshold } ?? true
            let hadBaseline = (lastBright != nil)
            lastBright = bright
            if hadBaseline && changed {
                emit("BRIGHT\t\(bright)")
            }
        }
    }
}

// App accessory : pas d'icone dans le dock, pas de fenetre.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let monitor = HudMonitor()
monitor.start()
app.run()
