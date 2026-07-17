// Helper Quick Look natif : affiche un vrai QLPreviewPanel pour la liste de fichiers
// passee en arguments. Le panneau gere NATIVEMENT la barre d'espace (fermer), Echap
// (fermer) et les fleches gauche/droite (naviguer entre les documents) -> comme dans
// le Finder. On s'active soi-meme pour que le panneau prenne le focus clavier.
//
// Usage : QuickLook <fichier1> <fichier2> ...
// Se termine quand l'utilisateur ferme l'apercu.
import Cocoa
import Quartz

final class PreviewController: NSObject, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
    let urls: [URL]
    init(urls: [URL]) { self.urls = urls }
    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int { return urls.count }
    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        return urls[index] as NSURL
    }
    // Laisse le panneau gerer les touches (fleches = navigation, espace/echap = fermeture).
    func previewPanel(_ panel: QLPreviewPanel!, handle event: NSEvent!) -> Bool { return false }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let controller: PreviewController
    var observer: NSObjectProtocol?
    init(controller: PreviewController) { self.controller = controller }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // .regular : l'app devient reellement au premier plan -> le panneau prend le
        // focus clavier (espace/echap/fleches lui parviennent). Icone Dock breve.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        guard let panel = QLPreviewPanel.shared() else { NSApp.terminate(nil); return }
        panel.dataSource = controller
        panel.delegate = controller
        panel.currentPreviewItemIndex = 0
        panel.makeKeyAndOrderFront(nil)
        // Au-dessus de l'encoche (elle est a main-menu+3) pour ne pas s'ouvrir derriere.
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 4)
        // Quand le panneau se ferme (espace/echap/clic), on quitte le helper.
        observer = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification, object: panel, queue: .main
        ) { _ in NSApp.terminate(nil) }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { return true }
}

let paths = Array(CommandLine.arguments.dropFirst())
let urls = paths
    .map { URL(fileURLWithPath: $0) }
    .filter { FileManager.default.fileExists(atPath: $0.path) }
if urls.isEmpty { exit(0) }

let app = NSApplication.shared
let controller = PreviewController(urls: urls)
let delegate = AppDelegate(controller: controller)
app.delegate = delegate
app.run()
