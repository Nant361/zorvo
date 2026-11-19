// A standalone design spike. This file is not built or bundled by Zorvo.
import AppKit
import WebKit

struct ProbeFailure: Error, CustomStringConvertible {
  let description: String
  init(_ message: String) { description = message }
}

@MainActor
final class Probe: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  var window: NSWindow!
  var tabs: [WKWebView] = []
  var results: [[String: Any]] = []
  var mediaDecisions = 0
  var locationDecisions = 0
  var displayDecisions = 0
  var didFinish = false
  let world = WKContentWorld.world(name: "zorvo.browser.spike")
  let args = CommandLine.arguments
  let trusted = """
    (() => {
      const token = 'trusted';
      let count = 0;
      Object.defineProperty(globalThis, '__zorvoProbe', {value: Object.freeze({
        dispatch(args) {
          if (args.operation === 'snapshot') return {source: token, count: ++count, title: document.title, input: document.querySelector('#input').value};
          if (args.operation === 'fill') {document.querySelector('#input').value = args.value; return true;}
          throw new Error('unknown operation');
        }
      })});
    })();
    """

  func applicationDidFinishLaunching(_ notification: Notification) {
    window = NSWindow(
      contentRect: NSRect(x: 100, y: 100, width: 720, height: 560),
      styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    let finish = NSButton(title: "Finish checks", target: self, action: #selector(finishChecks))
    finish.frame = NSRect(x: 550, y: 524, width: 150, height: 28)
    finish.autoresizingMask = [.minXMargin, .minYMargin]
    window.contentView!.addSubview(finish)
    window.title = "Zorvo WKWebView spike"
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    Task {
      do { try await run() } catch { record("harness", false, String(describing: error)) }
      do {
        let output: [String: Any] = [
          "os": ProcessInfo.processInfo.operatingSystemVersionString, "results": results,
        ]
        try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
          .write(to: URL(fileURLWithPath: args[2]))
      } catch { fputs("Cannot write results: \(error)\n", stderr) }
      NSApp.terminate(nil)
    }
  }

  func record(_ gate: String, _ pass: Bool?, _ evidence: Any) {
    let status = pass.map { $0 ? "pass" : "fail" } ?? "unverified"
    results.append(["gate": gate, "status": status, "evidence": evidence])
    print("\(status.uppercased()) \(gate): \(evidence)")
    fflush(stdout)
  }

  func makeTab(_ store: WKWebsiteDataStore) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = store
    config.userContentController.addUserScript(
      WKUserScript(
        source: trusted, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: world))
    var bounds = window.contentView!.bounds
    bounds.size.height -= 40
    let tab = WKWebView(frame: bounds, configuration: config)
    tab.autoresizingMask = [.width, .height]
    tab.navigationDelegate = self
    tab.uiDelegate = self
    window.contentView!.addSubview(tab)
    tabs.append(tab)
    return tab
  }

  func js(_ tab: WKWebView, _ source: String, in context: WKContentWorld? = nil) async throws -> Any
  {
    try await withCheckedThrowingContinuation { continuation in
      tab.evaluateJavaScript(source, in: nil, in: context ?? .page) {
        continuation.resume(with: $0)
      }
    }
  }

  func command(_ tab: WKWebView, _ arguments: [String: Any]) async throws -> Any {
    try await withCheckedThrowingContinuation { continuation in
      tab.callAsyncJavaScript(
        "return globalThis.__zorvoProbe.dispatch(args)", arguments: ["args": arguments], in: nil,
        in: world
      ) { continuation.resume(with: $0) }
    }
  }

  func pause(_ milliseconds: UInt64) async throws {
    try await Task.sleep(nanoseconds: milliseconds * 1_000_000)
  }

  func load(_ tab: WKWebView, _ path: String) async throws {
    let url = URL(string: "http://127.0.0.1:\(args[1])\(path)")!
    tab.load(URLRequest(url: url))
    for _ in 0..<200 {
      try await pause(50)
      if !tab.isLoading, tab.url == url { return }
    }
    throw ProbeFailure("Navigation timed out: \(path)")
  }

  func cookie(_ store: WKWebsiteDataStore) async -> String {
    await withCheckedContinuation { continuation in
      store.httpCookieStore.getAllCookies { cookies in
        continuation.resume(
          returning: cookies.filter { $0.name == "session" }.map(\.value).sorted().joined(
            separator: ","))
      }
    }
  }

  func permission(_ tab: WKWebView, _ kind: String, _ source: String) async throws -> String {
    _ = try await js(tab, "globalThis.permissionResults.\(kind) = 'pending'; \(source); true")
    for _ in 0..<60 {
      try await pause(50)
      let status = try await js(tab, "globalThis.permissionResults.\(kind)") as? String ?? "missing"
      if status != "pending" { return status }
    }
    return "timeout"
  }

  func run() async throws {
    let storeA = WKWebsiteDataStore.nonPersistent()
    let storeB = WKWebsiteDataStore.nonPersistent()
    let a1 = makeTab(storeA)
    try await load(a1, "/seed?value=alpha")
    let a2 = makeTab(storeA)
    a1.isHidden = true
    try await load(a2, "/who")
    let same = try await js(a2, "document.body.textContent") as? String ?? ""
    let b = makeTab(storeB)
    a2.isHidden = true
    try await load(b, "/who")
    let other = try await js(b, "document.body.textContent") as? String ?? ""
    record(
      "cookies per session", same.contains("session=alpha") && !other.contains("session=alpha"),
      [
        "sameSession": same, "otherSession": other, "storeA": await cookie(storeA),
        "storeB": await cookie(storeB),
      ])
    try await load(b, "/seed?value=beta")
    let cookieA = await cookie(storeA)
    let cookieB = await cookie(storeB)
    record(
      "no cookie overwrite across sessions", cookieA == "alpha" && cookieB == "beta",
      ["storeA": cookieA, "storeB": cookieB])

    let snapshot = try await command(a1, ["operation": "snapshot"]) as? [String: Any] ?? [:]
    let page = try await js(a1, "globalThis.__zorvoProbe.dispatch()") as? String ?? ""
    let injection = "'); globalThis.__zorvoProbe = null; //"
    _ = try await command(a1, ["operation": "fill", "value": injection])
    let after = try await command(a1, ["operation": "snapshot"]) as? [String: Any] ?? [:]
    record(
      "isolated content world",
      snapshot["source"] as? String == "trusted" && page == "forged"
        && after["source"] as? String == "trusted" && after["input"] as? String == injection,
      ["trusted": snapshot, "page": page, "afterLiteralArgument": after])
    record(
      "no app bridge in page world",
      (try await js(
        a1,
        "[typeof window.__TAURI_INTERNALS__, typeof window.webkit?.messageHandlers?.zorvo].join(',')"
      ) as? String) == "undefined,undefined",
      "No Tauri IPC script or page-world message handler installed")

    try await load(a2, "/")
    let hiddenFill =
      try await command(a2, ["operation": "fill", "value": "filled while hidden"]) as? Bool ?? false
    let hiddenState = try await command(a2, ["operation": "snapshot"]) as? [String: Any] ?? [:]
    record(
      "hidden tab works",
      a2.isHidden && hiddenFill && hiddenState["input"] as? String == "filled while hidden",
      hiddenState)

    b.isHidden = true
    a1.isHidden = false
    let camera = try await permission(
      a1, "camera",
      "navigator.mediaDevices.getUserMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());permissionResults.camera='GRANTED'},e=>permissionResults.camera=e.name)"
    )
    let mic = try await permission(
      a1, "microphone",
      "navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());permissionResults.microphone='GRANTED'},e=>permissionResults.microphone=e.name)"
    )
    var geo = "unsupported public delegate"
    if #available(macOS 27.0, *) {
      geo = try await permission(
        a1, "geolocation",
        "navigator.geolocation.getCurrentPosition(()=>permissionResults.geolocation='GRANTED',e=>permissionResults.geolocation=String(e.code),{timeout:2000})"
      )
    }
    record(
      "camera denied", camera == "NotAllowedError",
      ["result": camera, "delegateCalls": mediaDecisions])
    record(
      "microphone denied", mic == "NotAllowedError",
      ["result": mic, "delegateCalls": mediaDecisions])
    record(
      "geolocation denied",
      geo == "unsupported public delegate" ? nil : geo == "1" && locationDecisions > 0,
      ["result": geo, "delegateCalls": locationDecisions])
    let displayType =
      try await js(a1, "typeof navigator.mediaDevices?.getDisplayMedia") as? String ?? "unknown"
    _ = try await js(
      a1,
      "globalThis.permissionResults.screen = 'not requested'; globalThis.frameTimes=[]; globalThis.lastFrame=performance.now(); globalThis.lastScroll=-1000; document.addEventListener('scroll',()=>lastScroll=performance.now(),{passive:true}); globalThis.rafID=requestAnimationFrame(function tick(t){if(t-lastScroll<100) frameTimes.push(t-lastFrame);lastFrame=t;rafID=requestAnimationFrame(tick)}); true"
    )
    window.title = "Zorvo WKWebView spike: request screen, scroll, finish checks"
    print("INTERACTIVE_READY")
    fflush(stdout)
    for _ in 0..<1200 {
      if didFinish { break }
      try await pause(100)
    }
    let screen = try await js(a1, "JSON.stringify(permissionResults)") as? String ?? ""
    let permissionData =
      try JSONSerialization.jsonObject(with: Data(screen.utf8)) as? [String: Any] ?? [:]
    let gesture = permissionData["screenGesture"] as? [String: Any] ?? [:]
    let screenPass =
      permissionData["screen"] as? String == "NotAllowedError"
      && gesture["trusted"] as? Bool == true && gesture["active"] as? Bool == true
      && displayDecisions > 0
    record(
      "screen capture denial", screenPass,
      [
        "api": displayType, "result": screen, "delegateCalls": displayDecisions,
        "usesPrivateAPI": args.contains("--screen-spi"),
        "limitation":
          "SPI is diagnostic only and requires a separate design decision and OS coverage.",
      ])
    let scroll =
      try await js(
        a1,
        "cancelAnimationFrame(rafID); JSON.stringify({y:scrollY,frames:frameTimes.length,p95:frameTimes.sort((a,b)=>a-b)[Math.floor(frameTimes.length*.95)]})"
      ) as? String ?? ""
    let scrollData =
      try JSONSerialization.jsonObject(with: Data(scroll.utf8)) as? [String: Any] ?? [:]
    record("native scroll smoke check", (scrollData["y"] as? Int ?? 0) > 0, scrollData)
    record(
      "scroll performance", nil,
      "Native input is a functional observation, not a trackpad comparison, CPU/RAM or simultaneous chat-stream benchmark."
    )

  }

  @objc func finishChecks(_ sender: NSButton) { didFinish = true }

  override func responds(to selector: Selector!) -> Bool {
    guard let selector else { return false }
    if NSStringFromSelector(selector).contains("requestDisplayCapturePermissionForOrigin"),
      !args.contains("--screen-spi")
    {
      return false
    }
    return super.responds(to: selector)
  }

  // Diagnostic SPI only. The public WKUIDelegate media callback has no screen case.
  @objc(
    _webView:requestDisplayCapturePermissionForOrigin:initiatedByFrame:withSystemAudio:
    decisionHandler:
  )
  func denyDisplay(
    _ view: WKWebView, origin: WKSecurityOrigin, frame: WKFrameInfo, systemAudio: Bool,
    decision: @escaping @convention(block) (Int) -> Void
  ) {
    displayDecisions += 1
    decision(0)  // WKDisplayCapturePermissionDecisionDeny in WebKit's private header.
  }

  @objc(_webView:requestDisplayCapturePermissionForOrigin:initiatedByFrame:decisionHandler:)
  func denyLegacyDisplay(
    _ view: WKWebView, origin: WKSecurityOrigin, frame: WKFrameInfo,
    decision: @escaping @convention(block) (Int) -> Void
  ) {
    displayDecisions += 1
    decision(0)
  }

  func webView(
    _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    mediaDecisions += 1
    decisionHandler(.deny)
  }

  @available(macOS 27.0, *)
  func webView(
    _ webView: WKWebView, requestGeolocationPermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    locationDecisions += 1
    decisionHandler(.deny)
  }
}

@main
struct Launcher {
  @MainActor static func main() {
    guard CommandLine.arguments.count >= 3 else {
      fputs("Usage: probe <fixture port> <result.json> [--screen-spi]\n", stderr)
      return
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let probe = Probe()
    app.delegate = probe
    app.run()
    withExtendedLifetime(probe) {}
  }
}
