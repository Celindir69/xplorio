// Xplorio for the Mac: a window with Xplorio in it (web view), like a web app with its own icon.
// Opening starts MPD, the tag service and the web server (Resources/xplorio/mac/xplorio-services.sh start),
// closing the window or quitting stops all three again (… stop). Built on the Mac by tools/mac/make-app.sh with swiftc.
import Cocoa
import WebKit

let resources = Bundle.main.resourcePath ?? "."
let servicesScript = resources + "/xplorio/mac/xplorio-services.sh"
let pageURL = URL(string: "http://localhost:4040/")!

/// runs the services script; returns (exit code, printed text)
func services(_ command: String) -> (Int32, String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = [servicesScript, command]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return (1, "Das Startskript fehlt: \(servicesScript)") }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return (p.terminationStatus, String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
}

class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var stopped = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()          // settings of the page stay (localStorage)
        config.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Xplorio"
        window.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 1)
        window.contentView = web
        window.delegate = self
        window.setFrameAutosaveName("XplorioWindow")                     // size and place stay
        if !window.setFrameUsingName("XplorioWindow") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.loadHTMLString(waitPage("Xplorio startet …"), baseURL: nil)

        DispatchQueue.global(qos: .userInitiated).async {
            let (code, text) = services("start")
            DispatchQueue.main.async {
                if code == 0 {
                    self.web.load(URLRequest(url: pageURL))
                } else {
                    self.web.loadHTMLString(self.waitPage(text.isEmpty ? "Xplorio startet nicht." : text), baseURL: nil)
                }
            }
        }
    }

    func waitPage(_ text: String) -> String {
        let t = text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        return "<html><body style=\"background:#141414;color:#ddd;font:15px -apple-system,sans-serif;display:flex;" +
               "align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:0 40px\">" +
               "<div>" + t + "</div></body></html>"
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Xplorio ausblenden", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Xplorio beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Bearbeiten")
        edit.addItem(withTitle: "Ausschneiden", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Kopieren", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Einsetzen", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Alles auswählen", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)
        let viewItem = NSMenuItem()
        let view = NSMenu(title: "Darstellung")
        view.addItem(withTitle: "Neu laden", action: #selector(reloadPage), keyEquivalent: "r")
        let full = NSMenuItem(title: "Vollbild", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        view.addItem(full)
        viewItem.submenu = view
        main.addItem(viewItem)
        NSApp.mainMenu = main
    }

    @objc func reloadPage() { web.load(URLRequest(url: pageURL)) }

    // links to other sites (Wikipedia, Last.fm, …) open in the normal browser
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, let host = url.host,
           navigationAction.navigationType == .linkActivated, host != "localhost", host != "127.0.0.1" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
    // target="_blank" and window.open: also in the normal browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    // closing the window ends the program, and with it MPD, tag service and web server
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { return true }
    func applicationWillTerminate(_ notification: Notification) {
        if stopped { return }
        stopped = true
        _ = services("stop")
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
