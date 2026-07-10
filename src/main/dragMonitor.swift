// Attrapeur de drop natif (macOS), facon Yoink/Dropover.
//
// Une petite fenetre transparente couvre la zone de l'encoche ouverte (640x190,
// centree en haut). Elle est masquee au repos, et affichee UNIQUEMENT pendant un
// drag de fichier (detecte via boutons souris + changeCount du presse-papiers de
// drag). Comme c'est une vraie cible de depot enregistree (registerForDraggedTypes),
// le drop est CONSOMME -> plus de copie parasite sur le bureau derriere.
//
// Emet sur stdout :
//   START                         un drag de contenu commence
//   END                           le drag se termine
//   DROP\t<x>\t<y>\t<base64>      un fichier a ete lache sur la zone (base64 = JSON des chemins)
//
// Lit sur stdin :
//   AIRDROP\t<base64>            declenche le panneau AirDrop natif pour ces fichiers
import AppKit
import Foundation

let OPEN_W: CGFloat = 640
let OPEN_H: CGFloat = 190

func emit(_ s: String) { print(s); fflush(stdout) }

func readFilePaths(_ pb: NSPasteboard) -> [String] {
    let opts: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    if let urls = pb.readObjects(forClasses: [NSURL.self], options: opts) as? [URL] {
        return urls.filter { $0.isFileURL }.map { $0.path }
    }
    if let names = pb.propertyList(forType: NSPasteboard.PasteboardType("NSFilenamesPboardType")) as? [String] {
        return names
    }
    return []
}

// Vue qui accepte le depot de fichiers.
class DropView: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        // Large : URL de fichier + ancien type de noms de fichiers + item generique.
        registerForDraggedTypes([
            .fileURL,
            NSPasteboard.PasteboardType("public.file-url"),
            NSPasteboard.PasteboardType("NSFilenamesPboardType"),
            NSPasteboard.PasteboardType("public.url"),
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    override func draggingEntered(_ s: NSDraggingInfo) -> NSDragOperation { .copy }
    override func draggingUpdated(_ s: NSDraggingInfo) -> NSDragOperation { .copy }
    override func prepareForDragOperation(_ s: NSDraggingInfo) -> Bool { true }

    override func performDragOperation(_ s: NSDraggingInfo) -> Bool {
        let paths = readFilePaths(s.draggingPasteboard)
        let pt = NSEvent.mouseLocation // ecran, origine bas-gauche
        if let data = try? JSONSerialization.data(withJSONObject: paths) {
            emit("DROP\t\(Int(pt.x))\t\(Int(pt.y))\t" + data.base64EncodedString())
        }
        return true // consomme le drop
    }
}

class Catcher: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let dragPb = NSPasteboard(name: .drag)
    var leftDown = false
    var baseCC = 0
    var dragActive = false
    var shown = false

    func applicationDidFinishLaunching(_ n: Notification) {
        baseCC = dragPb.changeCount
        let rect = zoneRect()
        window = NSWindow(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = false
        // CRITIQUE : niveau .floating (3). macOS 26 NE ROUTE PAS les drag & drop
        // vers les fenetres au niveau screen-saver (1000+) ni au niveau bouclier.
        // Au niveau flottant, le drop est capte. La fenetre est donc SOUS l'encoche
        // Electron (niveau ~1001), mais le drag la traverse (elle n'est pas une cible
        // enregistree) et atteint l'attrapeur en dessous.
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.contentView = DropView(frame: NSRect(x: 0, y: 0, width: rect.width, height: rect.height))
        window.orderOut(nil)
        Timer.scheduledTimer(withTimeInterval: 0.04, repeats: true) { [weak self] _ in self?.poll() }
        setupStdin()
    }

    // Ecoute les commandes d'Electron sur stdin (ex. AIRDROP\t<base64 JSON chemins>).
    func setupStdin() {
        let h = FileHandle.standardInput
        h.readabilityHandler = { [weak self] fh in
            let data = fh.availableData
            guard !data.isEmpty, let str = String(data: data, encoding: .utf8) else { return }
            for raw in str.split(separator: "\n") {
                self?.handleCommand(String(raw))
            }
        }
    }

    func handleCommand(_ line: String) {
        let parts = line.components(separatedBy: "\t")
        guard parts.count >= 2 else { return }
        if parts[0] == "AIRDROP",
           let data = Data(base64Encoded: parts[1]),
           let arr = try? JSONSerialization.jsonObject(with: data) as? [String] {
            DispatchQueue.main.async { self.sendViaAirDrop(arr) }
        }
    }

    // Ouvre DIRECTEMENT le panneau AirDrop (pas le menu de partage complet).
    func sendViaAirDrop(_ paths: [String]) {
        let urls = paths.map { URL(fileURLWithPath: $0) }
        guard !urls.isEmpty, let service = NSSharingService(named: .sendViaAirDrop) else { return }
        NSApp.activate(ignoringOtherApps: true)
        service.perform(withItems: urls)
    }

    func zoneRect() -> NSRect {
        // Ecran SOUS le curseur (support multi-ecrans), sinon principal.
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) })
            ?? NSScreen.main ?? NSScreen.screens.first
        guard let sf = screen?.frame else {
            return NSRect(x: 400, y: 700, width: OPEN_W, height: OPEN_H)
        }
        return NSRect(x: sf.midX - OPEN_W / 2, y: sf.maxY - OPEN_H, width: OPEN_W, height: OPEN_H)
    }

    func show() {
        if shown { return }
        shown = true
        window.setFrame(zoneRect(), display: false)
        window.orderFrontRegardless()
    }
    func hide() {
        if !shown { return }
        shown = false
        window.orderOut(nil)
    }

    func poll() {
        let left = (NSEvent.pressedMouseButtons & 1) == 1
        let cc = dragPb.changeCount
        if left && !leftDown { leftDown = true; baseCC = cc }
        if leftDown && cc != baseCC && !dragActive {
            dragActive = true
            emit("START")
            show()
        }
        if !left && leftDown {
            leftDown = false
            if dragActive {
                dragActive = false
                emit("END")
                // On masque un poil apres pour laisser performDragOperation finir.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in self?.hide() }
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // pas d'icone dans le dock
let delegate = Catcher()
app.delegate = delegate
app.run()
