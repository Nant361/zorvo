import AppKit
import WebKit

@main
@MainActor
final class ScrollHost: NSObject, NSApplicationDelegate, WKNavigationDelegate,
  WKScriptMessageHandlerWithReply
{
  private var window: NSWindow?
  private var pageView: WKWebView?
  private var chatView: WKWebView?
  private let url: URL
  private let restricted: Bool
  private let split: Bool

  init(_ url: URL, restricted: Bool, split: Bool) {
    self.url = url
    self.restricted = restricted
    self.split = split
  }

  static func main() {
    let arguments = Array(CommandLine.arguments.dropFirst())
    let flags = Array(arguments.dropFirst())
    guard let address = arguments.first,
      flags.allSatisfy({ ["--restricted", "--split"].contains($0) }),
      Set(flags).count == flags.count,
      let url = URL(string: address), url.scheme == "http",
      url.host == "127.0.0.1", url.port != nil,
      url.user == nil, url.password == nil
    else {
      fputs("Usage: probe <loopback fixture URL> [--restricted] [--split]\n", stderr)
      exit(1)
    }
    if flags.contains("--restricted") {
      guard #available(macOS 13.0, *) else {
        fputs("The per-view restriction requires macOS 13 or newer.\n", stderr)
        exit(1)
      }
    }
    let host = ScrollHost(
      url, restricted: flags.contains("--restricted"), split: flags.contains("--split"))
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    app.delegate = host
    app.run()
    withExtendedLifetime(host) {}
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let bounds = NSRect(x: 100, y: 100, width: 600, height: 510)
    let window = NSWindow(
      contentRect: bounds, styleMask: [.titled, .closable], backing: .buffered, defer: false)
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    if restricted, #available(macOS 13.0, *) {
      config.defaultWebpagePreferences.isLockdownModeEnabled = true
    }
    if split {
      config.userContentController.addScriptMessageHandler(
        self, contentWorld: .page, name: "scrollBench")
    }
    let view = WKWebView(frame: window.contentView!.bounds, configuration: config)
    view.navigationDelegate = self
    window.contentView!.addSubview(view)
    pageView = view
    if split {
      let chatConfig = WKWebViewConfiguration()
      chatConfig.websiteDataStore = .nonPersistent()
      let chat = WKWebView(
        frame: NSRect(x: 244, y: 134, width: 180, height: 340), configuration: chatConfig)
      chat.navigationDelegate = self
      window.contentView!.addSubview(chat)
      chatView = chat
      chat.load(URLRequest(url: withRole("chat")))
    }
    self.window = window
    window.title = "WK browser scroll comparison"
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    view.load(URLRequest(url: split ? withRole("page") : url))
  }

  private func withRole(_ role: String) -> URL {
    var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    parts.queryItems = (parts.queryItems ?? []).filter { $0.name != "role" }
    parts.queryItems!.append(URLQueryItem(name: "role", value: role))
    return parts.url!
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let destination = navigationAction.request.url
    let allowed =
      destination?.scheme == url.scheme && destination?.host == url.host
      && destination?.port == url.port && destination?.user == nil && destination?.password == nil
    decisionHandler(allowed ? .allow : .cancel)
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping (Any?, String?) -> Void
  ) {
    guard message.webView === pageView, message.frameInfo.isMainFrame,
      message.frameInfo.securityOrigin.host == url.host,
      message.frameInfo.securityOrigin.port == url.port,
      let body = message.body as? [String: Any], let operation = body["command"] as? String,
      ["begin", "end"].contains(operation), let stream = body["stream"] as? Bool,
      let chat = chatView
    else {
      replyHandler(nil, "Invalid fixture command.")
      return
    }
    chat.callAsyncJavaScript(
      """
      if (!globalThis.__scrollWorkload) throw new Error("The chat fixture has not loaded.");
      if (operation === "begin") { globalThis.__scrollWorkload.begin(stream); return true; }
      return await globalThis.__scrollWorkload.end();
      """,
      arguments: ["operation": operation, "stream": stream], in: nil, in: .page
    ) { result in
      switch result {
      case .success(let value): replyHandler(value, nil)
      case .failure(let error): replyHandler(nil, String(describing: error))
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
