// A standalone design spike. This file is not built or bundled by Zorvo.
import AppKit
import WebKit

struct ProbeFailure: Error, CustomStringConvertible {
  let description: String
  init(_ message: String) { description = message }
}

@MainActor
final class Probe: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
  WKScriptMessageHandler
{
  var window: NSWindow!
  var tabs: [WKWebView] = []
  var results: [[String: Any]] = []
  var mediaDecisions = 0
  var locationDecisions = 0
  var displayDecisions = 0
  var didFinish = false
  var childFrames: [(view: WKWebView, frame: WKFrameInfo)] = []
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
    if args.contains("--restricted"), #available(macOS 13.0, *) {
      config.defaultWebpagePreferences.isLockdownModeEnabled = true
      config.userContentController.add(self, contentWorld: world, name: "probeFrame")
      config.userContentController.addUserScript(
        WKUserScript(
          source: "window.webkit.messageHandlers.probeFrame.postMessage(true)",
          injectionTime: .atDocumentEnd, forMainFrameOnly: false, in: world))
    }
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

  func js(
    _ tab: WKWebView, _ source: String, in context: WKContentWorld? = nil,
    frame: WKFrameInfo? = nil
  ) async throws -> Any {
    try await withCheckedThrowingContinuation { continuation in
      tab.evaluateJavaScript(source, in: frame, in: context ?? .page) {
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
        "[typeof window.__TAURI_INTERNALS__, typeof window.webkit?.messageHandlers?.zorvo, typeof window.webkit?.messageHandlers?.probeFrame].join(',')"
      ) as? String) == "undefined,undefined,undefined",
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
    if args.contains("--restricted") {
      try await checkRestrictedPermissions(a1)
      return
    }
    let beforeCamera = mediaDecisions
    let camera = try await permission(
      a1, "camera",
      "navigator.mediaDevices.getUserMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());permissionResults.camera='GRANTED'},e=>permissionResults.camera=e.name)"
    )
    let cameraDecisions = mediaDecisions - beforeCamera
    let beforeMicrophone = mediaDecisions
    let mic = try await permission(
      a1, "microphone",
      "navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());permissionResults.microphone='GRANTED'},e=>permissionResults.microphone=e.name)"
    )
    let microphoneDecisions = mediaDecisions - beforeMicrophone
    var geo = "unsupported public delegate"
    if #available(macOS 27.0, *) {
      geo = try await permission(
        a1, "geolocation",
        "navigator.geolocation.getCurrentPosition(()=>permissionResults.geolocation='GRANTED',e=>permissionResults.geolocation=String(e.code),{timeout:2000})"
      )
    }
    record(
      "camera denied", camera == "NotAllowedError" && cameraDecisions > 0,
      ["result": camera, "delegateCalls": cameraDecisions])
    record(
      "microphone denied", mic == "NotAllowedError" && microphoneDecisions > 0,
      ["result": mic, "delegateCalls": microphoneDecisions])
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

  func checkRestrictedPermissions(_ tab: WKWebView) async throws {
    guard #available(macOS 13.0, *) else {
      throw ProbeFailure("The per-view restriction requires macOS 13 or newer.")
    }
    let body = """
      const frame = document.createElement("iframe");
      frame.src = "/?nested";
      const loaded = new Promise(resolve => frame.onload = resolve);
      document.body.append(frame);
      await loaded;
      return [window, frame.contentWindow].map(w => ({
        secure: w.isSecureContext,
        cameraOrMicrophone: typeof w.navigator.mediaDevices?.getUserMedia,
        screen: typeof w.navigator.mediaDevices?.getDisplayMedia,
        legacy: typeof w.navigator.webkitGetUserMedia,
        location: typeof w.navigator.geolocation
      }));
      """
    let surfaces: [[String: Any]] = try await withCheckedThrowingContinuation { continuation in
      tab.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
        continuation.resume(
          with: result.flatMap { value in
            guard let frames = value as? [[String: Any]] else {
              return .failure(ProbeFailure("Missing frame permission observations"))
            }
            return .success(frames)
          })
      }
    }
    let protected =
      surfaces.count == 2
      && surfaces.allSatisfy {
        $0["secure"] as? Bool == true && $0["cameraOrMicrophone"] as? String == "undefined"
          && $0["screen"] as? String == "undefined" && $0["legacy"] as? String == "undefined"
      }
    record("restricted capture in top document and subframe", protected, surfaces)
    guard #available(macOS 27.0, *) else {
      record("location denied in document", nil, "The public location delegate requires macOS 27.")
      record("location denied in frame", nil, "The public location delegate requires macOS 27.")
      try await checkCrossOriginFrame(tab)
      return
    }
    for (label, target) in [
      ("document", "window"), ("frame", "document.querySelector('iframe').contentWindow"),
    ] {
      let before = locationDecisions
      let result = try await permission(
        tab, "location",
        "\(target).navigator.geolocation.getCurrentPosition(()=>permissionResults.location='GRANTED',e=>permissionResults.location=String(e.code))"
      )
      record(
        "location denied in " + label, result == "1" && locationDecisions > before,
        ["result": result, "callbacks": locationDecisions - before])
    }
    try await checkCrossOriginFrame(tab)
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    if !message.frameInfo.isMainFrame, let view = message.webView {
      childFrames.append((view, message.frameInfo))
    }
  }

  func checkCrossOriginFrame(_ tab: WKWebView) async throws {
    _ = try await js(
      tab,
      """
      const cross = document.createElement("iframe");
      cross.allow = "geolocation *; camera *; microphone *; display-capture *";
      cross.src = "http://localhost:\(args[1])/?cross";
      document.body.append(cross);
      true;
      """)
    var target: WKFrameInfo?
    for _ in 0..<200 {
      target =
        childFrames.first {
          $0.view === tab && $0.frame.securityOrigin.host == "localhost"
        }?.frame
      if target != nil { break }
      try await pause(50)
    }
    guard let target else { throw ProbeFailure("The cross-origin frame did not load.") }
    let surface =
      try await js(
        tab,
        """
        ({secure: isSecureContext, origin: location.origin,
          cameraOrMicrophone: typeof navigator.mediaDevices?.getUserMedia,
          screen: typeof navigator.mediaDevices?.getDisplayMedia,
          legacy: typeof navigator.webkitGetUserMedia})
        """, frame: target) as? [String: Any] ?? [:]
    record(
      "restricted capture in cross-origin frame",
      surface["secure"] as? Bool == true
        && surface["origin"] as? String == "http://localhost:\(args[1])"
        && surface["cameraOrMicrophone"] as? String == "undefined"
        && surface["screen"] as? String == "undefined"
        && surface["legacy"] as? String == "undefined", surface)
    guard #available(macOS 27.0, *) else {
      record(
        "location denied in cross-origin frame", nil,
        "The public location delegate requires macOS 27.")
      return
    }
    let before = locationDecisions
    let outcome: Any = try await withCheckedThrowingContinuation { continuation in
      tab.callAsyncJavaScript(
        """
        return await new Promise(resolve => {
          const deadline = setTimeout(() => resolve("timeout"), 3000);
          navigator.geolocation.getCurrentPosition(
            () => { clearTimeout(deadline); resolve("GRANTED"); },
            error => { clearTimeout(deadline); resolve(String(error.code)); },
            {timeout: 2000});
        });
        """, arguments: [:], in: target, in: .page
      ) { continuation.resume(with: $0) }
    }
    record(
      "location denied in cross-origin frame",
      outcome as? String == "1" && locationDecisions > before,
      ["result": outcome, "callbacks": locationDecisions - before])
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
    let arguments = CommandLine.arguments
    let flags = Array(arguments.dropFirst(3))
    guard [3, 4].contains(arguments.count), let port = Int(arguments[1]),
      (1...65535).contains(port),
      flags.allSatisfy({ ["--screen-spi", "--restricted"].contains($0) })
    else {
      fputs("Usage: probe <fixture port> <result.json> [--screen-spi | --restricted]\n", stderr)
      exit(1)
    }
    if flags.contains("--restricted") {
      guard #available(macOS 13.0, *) else {
        fputs("The per-view restriction requires macOS 13 or newer.\n", stderr)
        exit(1)
      }
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let probe = Probe()
    app.delegate = probe
    app.run()
    withExtendedLifetime(probe) {}
  }
}
