// MediaKeyInterceptor — intercepte les touches media (volume / luminosite) AVANT
// le systeme, applique le changement lui-meme, et CONSOMME l'evenement pour que
// macOS n'affiche PAS sa jauge native (OSD).
//
// Necessaire sur macOS 26 : l'OSD y est dessine in-process par ControlCenter (on ne
// peut ni le tuer ni le decharger, SIP). La SEULE facon d'empecher l'OSD est de ne
// jamais laisser l'evenement clavier media atteindre le systeme.
//
// Permission REQUISE : Accessibilite (Confidentialite &gt; Accessibilite). Sans elle,
// CGEvent.tapCreate renvoie nil. On demande la permission (prompt) au demarrage.
//
// Le HUD de l'app s'affiche tout seul : le HUDMonitor (autre helper) sonde volume /
// luminosite a 50 ms et detecte le changement qu'on applique -> pas d'IPC ici.
//
// Sortie stdout (lue par Electron) : "TAP_OK" | "NEED_ACCESSIBILITY" | "KEY <code>".

import Cocoa
import CoreGraphics
import CoreAudio

func emit(_ s: String) { print(s); fflush(stdout) }

// ---------------------------------------------------------------------------
// VOLUME (CoreAudio, comme HUDMonitor)
// ---------------------------------------------------------------------------
func fourCC(_ s: String) -> UInt32 {
    var r: UInt32 = 0
    for b in s.utf8 { r = (r << 8) + UInt32(b) }
    return r
}
let kVirtualMainVolume: AudioObjectPropertySelector = fourCC("vmvc")

func defaultOutputDevice() -> AudioObjectID {
    var dev = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    let st = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev)
    return st == noErr ? dev : AudioObjectID(kAudioObjectUnknown)
}

func volAddr() -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: kVirtualMainVolume,
                               mScope: kAudioObjectPropertyScopeOutput,
                               mElement: kAudioObjectPropertyElementMain)
}
func muteAddr() -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute,
                               mScope: kAudioObjectPropertyScopeOutput,
                               mElement: kAudioObjectPropertyElementMain)
}

func getVolume() -> Float? {
    let dev = defaultOutputDevice(); if dev == kAudioObjectUnknown { return nil }
    var a = volAddr(); if !AudioObjectHasProperty(dev, &a) { return nil }
    var v: Float32 = 0; var s = UInt32(MemoryLayout<Float32>.size)
    return AudioObjectGetPropertyData(dev, &a, 0, nil, &s, &v) == noErr ? max(0, min(1, v)) : nil
}
func setVolume(_ v: Float) -> Bool {
    let dev = defaultOutputDevice(); if dev == kAudioObjectUnknown { return false }
    var a = volAddr(); if !AudioObjectHasProperty(dev, &a) { return false }
    var nv = Float32(max(0, min(1, v))); let s = UInt32(MemoryLayout<Float32>.size)
    // Demute automatiquement si on monte le son (comportement macOS).
    if nv > 0 { _ = setMute(false) }
    return AudioObjectSetPropertyData(dev, &a, 0, nil, s, &nv) == noErr
}
func getMute() -> Bool? {
    let dev = defaultOutputDevice(); if dev == kAudioObjectUnknown { return nil }
    var a = muteAddr(); if !AudioObjectHasProperty(dev, &a) { return nil }
    var m: UInt32 = 0; var s = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(dev, &a, 0, nil, &s, &m) == noErr ? (m != 0) : nil
}
@discardableResult
func setMute(_ m: Bool) -> Bool {
    let dev = defaultOutputDevice(); if dev == kAudioObjectUnknown { return false }
    var a = muteAddr(); if !AudioObjectHasProperty(dev, &a) { return false }
    var mv: UInt32 = m ? 1 : 0; let s = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectSetPropertyData(dev, &a, 0, nil, s, &mv) == noErr
}

// ---------------------------------------------------------------------------
// LUMINOSITE (DisplayServices prive, via dlopen)
// ---------------------------------------------------------------------------
typealias DSGet = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
typealias DSSet = @convention(c) (UInt32, Float) -> Int32
let dsGet: DSGet? = {
    guard let h = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_NOW),
          let s = dlsym(h, "DisplayServicesGetBrightness") else { return nil }
    return unsafeBitCast(s, to: DSGet.self)
}()
let dsSet: DSSet? = {
    guard let h = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_NOW),
          let s = dlsym(h, "DisplayServicesSetBrightness") else { return nil }
    return unsafeBitCast(s, to: DSSet.self)
}()
func getBrightness() -> Float? {
    guard let fn = dsGet else { return nil }
    var b: Float = 0
    return fn(CGMainDisplayID(), &b) == 0 && b >= 0 && b <= 1 ? b : nil
}
func setBrightness(_ v: Float) -> Bool {
    guard let fn = dsSet else { return false }
    return fn(CGMainDisplayID(), max(0, min(1, v))) == 0
}

// ---------------------------------------------------------------------------
// Application d'une touche (renvoie true si applique -> on consomme l'evenement).
// ---------------------------------------------------------------------------
let STEP: Float = 1.0 / 16.0   // 16 crans, comme macOS

func handleKey(_ code: Int) -> Bool {
    switch code {
    case 0: guard let v = getVolume() else { return false }; return setVolume(v + STEP)   // SOUND_UP
    case 1: guard let v = getVolume() else { return false }; return setVolume(v - STEP)   // SOUND_DOWN
    case 7: guard let m = getMute() else { return false }; return setMute(!m)             // MUTE
    case 2: guard let b = getBrightness() else { return false }; return setBrightness(b + STEP) // BRIGHT_UP
    case 3: guard let b = getBrightness() else { return false }; return setBrightness(b - STEP) // BRIGHT_DOWN
    default: return false
    }
}
let TARGET: Set<Int> = [0, 1, 7, 2, 3]

// Capture F6 -> ecran eteint (option). MK_F6=1 active la capture des touches clavier
// (uniquement pour reperer F6 : keycode 97 standard OU un code de touche-fonction special
// annonce a l'app pour decouverte). MK_OFFCODE = code NX_SYSDEFINED a intercepter.
let F6_CAPTURE = ProcessInfo.processInfo.environment["MK_F6"] == "1"
let F6_OFFCODE = Int(ProcessInfo.processInfo.environment["MK_OFFCODE"] ?? "") ?? -1
let F6_KEYCODE: Int64 = 97 // F6 standard
// Mode DECOUVERTE (temporaire) : on OBSERVE et on annonce les codes des touches (keycode
// clavier + code media special) SANS rien consommer, pour identifier F6. Ne lit que des
// codes numeriques, jamais de texte.
let DISCOVER = ProcessInfo.processInfo.environment["MK_DISCOVER"] == "1"
// Keycodes des touches de FONCTION F1..F15 (les seules loggees en decouverte).
let FKEYS: Set<Int64> = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113]

// ---------------------------------------------------------------------------
// Event tap
// ---------------------------------------------------------------------------
final class Interceptor {
    var tap: CFMachPort?

    func begin() {
        // Permission Accessibilite. On n'affiche le PROMPT systeme qu'au 1er lancement
        // (MK_PROMPT=1, pose par le daemon) pour ne pas le repeter a chaque respawn.
        let prompt = ProcessInfo.processInfo.environment["MK_PROMPT"] == "1"
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
        let trusted = AXIsProcessTrustedWithOptions(opts)
        if !trusted { emit("NEED_ACCESSIBILITY") }

        // NX_SYSDEFINED (media) + keyDown (F6 standard) si la capture/decouverte est active.
        var mask: CGEventMask = (1 << 14)
        if F6_CAPTURE || DISCOVER { mask |= (1 << CGEventType.keyDown.rawValue) }
        let cb: CGEventTapCallBack = { _, type, event, refcon in
            let me = Unmanaged<Interceptor>.fromOpaque(refcon!).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let t = me.tap { CGEvent.tapEnable(tap: t, enable: true) }
                return Unmanaged.passUnretained(event)
            }
            // Touche clavier "normale" : on n'inspecte QUE le keycode (jamais le texte).
            // On n'agit / ne logue QUE pour les touches de FONCTION (F1-F15) -> aucune
            // frappe de texte n'est enregistree (pas de keylogging).
            if type == .keyDown {
                let kc = event.getIntegerValueField(.keyboardEventKeycode)
                if F6_CAPTURE && kc == F6_KEYCODE { emit("SCREENOFF"); return nil }
                if DISCOVER && FKEYS.contains(kc) { emit("DISCKEY \(kc)") } // F1-F15 seulement
                return Unmanaged.passUnretained(event)
            }
            // Evenement systeme (media / touches speciales).
            // DECOUVERTE : on logue TOUT ce qui arrive sur ce canal (type CGEvent + infos
            // NSEvent si convertible), pour reperer F6/Ne-pas-deranger meme s'il n'est pas
            // un media sous-type 8, ou si NSEvent ne le convertit pas.
            if DISCOVER {
                if let conv = NSEvent(cgEvent: event) {
                    emit("CH type=\(type.rawValue) ns=\(conv.type.rawValue) sub=\(conv.subtype.rawValue) d1=\(String(conv.data1, radix: 16))")
                } else {
                    emit("CH type=\(type.rawValue) ns=nil")
                }
            }
            guard let ns = NSEvent(cgEvent: event), ns.type == .systemDefined else {
                return Unmanaged.passUnretained(event)
            }
            let sub = ns.subtype.rawValue
            if sub != 8 {
                // Autre sous-type (ex. F6/Ne-pas-deranger) : on annonce la SIGNATURE
                // complete (sous-type + data1 + data2 en hexa) pour l'identifier sans
                // ambiguite avant de l'intercepter.
                if DISCOVER {
                    emit("SYSDEF sub=\(sub) d1=\(String(ns.data1, radix: 16)) d2=\(String(ns.data2, radix: 16))")
                }
                return Unmanaged.passUnretained(event)
            }
            let data1 = ns.data1
            let code = (data1 & 0xFFFF0000) >> 16
            let state = (data1 & 0x0000FF00) >> 8    // 0x0A = down, 0x0B = up
            let isDown = (state == 0x0A)
            if TARGET.contains(code) && isDown {
                if handleKey(code) {
                    emit("KEY \(code)")
                    return nil                        // CONSOMME -> pas d'OSD natif
                }
                // Echec d'application (ex. ecran externe sans DDC) -> on laisse passer
                // (fail open) : la touche reste fonctionnelle, quitte a montrer l'OSD natif.
            } else if isDown && (F6_CAPTURE || DISCOVER) {
                // Touche-fonction speciale non geree (ex. F6/Ne-pas-deranger) : on l'annonce
                // pour DECOUVERTE, et on l'intercepte si c'est le code configure.
                emit("SPECIAL \(code)")
                if F6_CAPTURE && code == F6_OFFCODE { emit("SCREENOFF"); return nil }
            }
            return Unmanaged.passUnretained(event)
        }
        guard let t = CGEvent.tapCreate(tap: .cghidEventTap, place: .headInsertEventTap,
                                        options: .defaultTap, eventsOfInterest: mask,
                                        callback: cb, userInfo: Unmanaged.passUnretained(self).toOpaque()) else {
            emit("TAP_FAIL")   // Accessibilite non accordee -> Electron guidera l'utilisateur
            return
        }
        tap = t
        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
        CGEvent.tapEnable(tap: t, enable: true)
        emit("TAP_OK")
        // Watchdog : re-arme le tap si macOS le desactive (race de signature connue).
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            if let t = self.tap, !CGEvent.tapIsEnabled(tap: t) { CGEvent.tapEnable(tap: t, enable: true) }
        }
        // Suicide si le parent (Electron) meurt -> jamais de tap clavier orphelin apres
        // un crash / kill brutal (sinon l'event tap survit et parasite le clavier).
        let parentPID = getppid()
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            if getppid() != parentPID { exit(0) } // reparente a launchd -> parent parti
        }
        CFRunLoopRun()
    }
}

let interceptor = Interceptor()
interceptor.begin()
// Si le tap a echoue on ne bloque pas : on tourne quand meme un court instant pour
// que le prompt s'affiche, puis on sort (Electron relancera).
if interceptor.tap == nil {
    RunLoop.current.run(until: Date().addingTimeInterval(3))
    exit(2)
}
