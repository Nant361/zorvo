import AVFoundation
import AppKit
import CoreGraphics
import CryptoKit
import Darwin
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
  var frames: [(view: WKWebView, frame: WKFrameInfo)] = []
  var screenPreferences: [Bool] = []
  let world = WKContentWorld.world(name: "zorvo.browser.spike")
  let args = CommandLine.arguments
  var usesCamera: Bool { ["usage-strings", "camera-only"].contains(args[3]) }
  var usesMicrophone: Bool { ["usage-strings", "microphone-only"].contains(args[3]) }

  let trusted = """
    (() => {
      let count = 0;
      Object.defineProperty(globalThis, "__zorvoProbe", {value: Object.freeze({
        dispatch(args) {
          if (args.operation === "snapshot") return {
            source: "trusted", count: ++count, title: document.title,
            input: document.querySelector("#input")?.value,
            proof: JSON.stringify({isInput: document.querySelector("#input")?.matches("input")}),
            state: document.querySelector("#react-value")?.textContent
          };
          const target = document.querySelector(args.selector || "#input");
          if (args.operation === "fill") {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(target, args.value);
            target.dispatchEvent(new Event("input", {bubbles: true}));
            return true;
          }
          if (args.operation === "click") { target.click(); return true; }
          throw new Error("unknown operation");
        }
      })});
    })();
    """

  func applicationDidFinishLaunching(_ notification: Notification) {
    do {
      try String(getpid()).write(
        to: URL(fileURLWithPath: args[2]).deletingLastPathComponent().appendingPathComponent(
          "probe.pid"),
        atomically: true, encoding: .utf8)
    } catch {
      fputs("Cannot record the test process identity.\n", stderr)
      NSApp.terminate(nil)
      return
    }
    window = NSWindow(
      contentRect: NSRect(x: 100, y: 100, width: 720, height: 560),
      styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false
    )
    window.isReleasedWhenClosed = false
    window.title = "Zorvo browser gate measurements"
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    Task {
      if ProcessInfo.processInfo.environment["ZORVO_BROWSER_SPIKE_REQUEST_PERMISSIONS"] == "1" {
        if !CGPreflightScreenCaptureAccess() {
          _ = await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
              continuation.resume(returning: CGRequestScreenCaptureAccess())
            }
          }
        }
        if usesCamera && usesMicrophone {
          for type in [AVMediaType.video, AVMediaType.audio] {
            _ = await withCheckedContinuation { continuation in
              AVCaptureDevice.requestAccess(for: type) { continuation.resume(returning: $0) }
            }
          }
        }
      } else {
        do { try await run() } catch { record("harness", false, String(describing: error)) }
      }
      let output: [String: Any] = [
        "os": ProcessInfo.processInfo.operatingSystemVersionString,
        "mode": args[3],
        "bundleIdentifier": Bundle.main.bundleIdentifier ?? "missing",
        "registeredApplication": NSWorkspace.shared.urlForApplication(
          withBundleIdentifier: Bundle.main.bundleIdentifier ?? "missing")?.path ?? "unresolved",
        "screenRecordingGranted": CGPreflightScreenCaptureAccess(),
        "mediaAuthorization": [
          "camera": self.authorizationName(.video), "microphone": self.authorizationName(.audio),
        ],
        "results": results,
      ]
      do {
        try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
          .write(to: URL(fileURLWithPath: args[2]))
      } catch { fputs("Cannot write results: \(error)\n", stderr) }
      for view in tabs {
        view.stopLoading()
        view.configuration.userContentController.removeScriptMessageHandler(
          forName: "probeFrame", contentWorld: world)
        view.removeFromSuperview()
      }
      frames.removeAll()
      tabs.removeAll()
      NSApp.terminate(nil)
    }
  }

  func record(_ gate: String, _ pass: Bool?, _ evidence: Any) {
    let status = pass.map { $0 ? "pass" : "fail" } ?? "unverified"
    results.append(["gate": gate, "status": status, "evidence": evidence])
    print("\(status.uppercased()) \(gate)")
    fflush(stdout)
  }

  func authorizationName(_ type: AVMediaType) -> String {
    switch AVCaptureDevice.authorizationStatus(for: type) {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not determined"
    @unknown default: return "unknown"
    }
  }

  func makeTab(_ store: WKWebsiteDataStore) throws -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = store
    let preferences = config.preferences
    let setter = NSSelectorFromString("_setScreenCaptureEnabled:")
    let getter = NSSelectorFromString("_screenCaptureEnabled")
    guard preferences.responds(to: setter), preferences.responds(to: getter) else {
      throw ProbeFailure("Screen capture preference selectors are unavailable.")
    }
    typealias SetFlag = @convention(c) (AnyObject, Selector, Bool) -> Void
    typealias GetFlag = @convention(c) (AnyObject, Selector) -> Bool
    let setFlag = unsafeBitCast(preferences.method(for: setter), to: SetFlag.self)
    let getFlag = unsafeBitCast(preferences.method(for: getter), to: GetFlag.self)
    setFlag(preferences, setter, false)
    let enabled = getFlag(preferences, getter)
    screenPreferences.append(enabled)
    guard !enabled else { throw ProbeFailure("The screen capture preference remained enabled.") }
    config.userContentController.add(self, contentWorld: world, name: "probeFrame")
    config.userContentController.addUserScript(
      WKUserScript(
        source: trusted, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: world))
    config.userContentController.addUserScript(
      WKUserScript(
        source: "window.webkit.messageHandlers.probeFrame.postMessage(true)",
        injectionTime: .atDocumentEnd, forMainFrameOnly: false, in: world))
    let view = WKWebView(frame: window.contentView!.bounds, configuration: config)
    view.autoresizingMask = [.width, .height]
    view.navigationDelegate = self
    view.uiDelegate = self
    window.contentView!.addSubview(view)
    tabs.append(view)
    return view
  }

  func js(
    _ view: WKWebView, _ source: String, in context: WKContentWorld? = nil,
    frame: WKFrameInfo? = nil
  ) async throws -> Any {
    try await withCheckedThrowingContinuation { continuation in
      view.evaluateJavaScript(source, in: frame, in: context ?? .page) {
        continuation.resume(with: $0)
      }
    }
  }

  func command(_ view: WKWebView, _ arguments: [String: Any]) async throws -> Any {
    try await withCheckedThrowingContinuation { continuation in
      view.callAsyncJavaScript(
        "return globalThis.__zorvoProbe.dispatch(args)", arguments: ["args": arguments], in: nil,
        in: world
      ) { continuation.resume(with: $0) }
    }
  }

  func pause(_ milliseconds: UInt64) async throws {
    try await Task.sleep(nanoseconds: milliseconds * 1_000_000)
  }

  func load(_ view: WKWebView, _ path: String) async throws {
    let url = URL(string: "http://127.0.0.1:\(args[1])\(path)")!
    view.load(URLRequest(url: url))
    for _ in 0..<200 {
      try await pause(50)
      if !view.isLoading, view.url == url,
        (try? await js(view, "document.querySelector('#react-value')?.textContent")) as? String
          != nil
      {
        return
      }
    }
    throw ProbeFailure("Navigation or React fixture readiness timed out.")
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

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    if !message.frameInfo.isMainFrame, let view = message.webView {
      frames.append((view, message.frameInfo))
    }
  }

  func run() async throws {
    let storeA = WKWebsiteDataStore.nonPersistent()
    let storeB = WKWebsiteDataStore.nonPersistent()
    let first = try makeTab(storeA)
    try await load(first, "/seed?value=alpha")
    let second = try makeTab(storeA)
    first.isHidden = true
    try await load(second, "/who")
    let same = try await js(second, "document.body.dataset.cookie") as? String ?? ""
    let other = try makeTab(storeB)
    second.isHidden = true
    try await load(other, "/who")
    let isolated = try await js(other, "document.body.dataset.cookie") as? String ?? ""
    record(
      "cookies per session", same.contains("session=alpha") && !isolated.contains("session=alpha"),
      ["sameSession": same, "otherSession": isolated])
    try await load(other, "/seed?value=beta")
    let cookieA = await cookie(storeA)
    let cookieB = await cookie(storeB)
    record(
      "no cookie overwrite across sessions", cookieA == "alpha" && cookieB == "beta",
      ["storeA": cookieA, "storeB": cookieB])
    other.isHidden = true
    first.isHidden = false
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(first)

    let injection = "'); globalThis.__zorvoProbe = null; //"
    _ = try await command(first, ["operation": "fill", "value": injection])
    _ = try await js(
      first,
      """
      globalThis.__originals = {query: document.querySelector, matches: Element.prototype.matches, stringify: JSON.stringify};
      globalThis.__zorvoProbe = {dispatch: () => "forged"};
      document.querySelector = () => null;
      Element.prototype.matches = () => false;
      JSON.stringify = () => "forged";
      true;
      """)
    let snapshot = try await command(first, ["operation": "snapshot"]) as? [String: Any] ?? [:]
    record(
      "isolated content world",
      snapshot["source"] as? String == "trusted" && snapshot["input"] as? String == injection
        && snapshot["proof"] as? String == "{\"isInput\":true}",
      snapshot)
    _ = try await js(
      first,
      """
      document.querySelector = __originals.query;
      Element.prototype.matches = __originals.matches;
      JSON.stringify = __originals.stringify;
      true;
      """)
    var controlled = ""
    for _ in 0..<100 {
      controlled =
        try await js(first, "document.querySelector('#controlled-value').textContent") as? String
        ?? ""
      if controlled == injection { break }
      try await pause(10)
    }
    record("React controlled input", controlled == injection, ["renderedValue": controlled])
    let bridge =
      try await js(
        first,
        """
        [typeof __TAURI_INTERNALS__, typeof window.webkit?.messageHandlers?.probeFrame].join(",")
        """) as? String ?? ""
    record("no app bridge in page world", bridge == "undefined,undefined", bridge)
    record(
      "screen capture preference disabled", screenPreferences.allSatisfy { !$0 },
      ["checkedConfigurations": screenPreferences.count, "enabled": screenPreferences])

    let usage = Bundle.main.infoDictionary ?? [:]
    let actualCamera = usage["NSCameraUsageDescription"] != nil
    let actualMicrophone = usage["NSMicrophoneUsageDescription"] != nil
    record(
      "bundle usage declarations",
      actualCamera == usesCamera && actualMicrophone == usesMicrophone
        && usage["NSLocationUsageDescription"] == nil,
      [
        "camera": actualCamera, "microphone": actualMicrophone,
        "location": usage["NSLocationUsageDescription"] != nil,
      ])
    record(
      "screen recording grant precondition", CGPreflightScreenCaptureAccess() ? true : nil,
      "Canonical spike 7 also requires the test app's own Screen Recording grant.")

    for (label, address) in [
      ("same-origin frame", "http://127.0.0.1:\(args[1])/?same"),
      ("cross-origin frame", "http://localhost:\(args[1])/?cross"),
    ] {
      _ = try await js(
        first,
        """
        (() => {
          const frame = document.createElement("iframe");
          frame.allow = "geolocation *; camera *; microphone *; display-capture *";
          frame.src = "\(address)";
          document.body.append(frame);
        })();
        true;
        """)
      let host = label == "same-origin frame" ? "127.0.0.1" : "localhost"
      for _ in 0..<200 {
        if frames.contains(where: { $0.view === first && $0.frame.securityOrigin.host == host }) {
          break
        }
        try await pause(50)
      }
    }
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
    try await pause(500)
    try await permissions(first, frame: nil, label: "document")
    for (label, host) in [("same-origin frame", "127.0.0.1"), ("cross-origin frame", "localhost")] {
      guard
        let frame = frames.first(where: {
          $0.view === first && $0.frame.securityOrigin.host == host
        })?.frame
      else {
        throw ProbeFailure("A permission-test iframe did not load.")
      }
      try await permissions(first, frame: frame, label: label)
    }
    if usesCamera && usesMicrophone {
      record(
        "native media delegate denied", mediaDecisions >= 2,
        ["callbacks": mediaDecisions])
    }
    if args[3] == "zorvo" {
      try await load(first, "/?activity")
      try await measureHiddenActivity(first)
    }
  }

  func permissions(_ view: WKWebView, frame: WKFrameInfo?, label: String) async throws {
    let surfaces =
      try await js(
        view,
        """
        ({
          secure: isSecureContext, origin: location.origin,
          documentHidden: document.hidden, documentHasFocus: document.hasFocus(),
          mediaDevices: typeof navigator.mediaDevices,
          cameraOrMicrophone: typeof navigator.mediaDevices?.getUserMedia,
          screen: typeof navigator.mediaDevices?.getDisplayMedia,
          legacy: typeof navigator.webkitGetUserMedia,
          wasm: typeof WebAssembly,
          dynamicJavaScript: Function("return 21 * 2")()
        })
        """, frame: frame) as? [String: Any] ?? [:]
    let absent = surfaces["mediaDevices"] as? String == "undefined"
    let present = surfaces["cameraOrMicrophone"] as? String == "function"
    let expected =
      args[3] == "zorvo" ? absent : args[3] == "usage-strings" ? present : absent || present
    record(
      "capture APIs in " + label,
      surfaces["secure"] as? Bool == true && expected
        && surfaces["screen"] as? String == "undefined" && surfaces["wasm"] as? String == "object"
        && surfaces["dynamicJavaScript"] as? Int == 42, surfaces)

    // A single usage string exposes mediaDevices, but the undeclared device can
    // terminate the app in TCC before our delegate. These modes observe APIs only.
    if usesCamera == usesMicrophone {
      for (kind, constraints) in [("camera", "{video:true}"), ("microphone", "{audio:true}")] {
        let before = mediaDecisions
        let outcome = try await asyncJS(
          view,
          """
          if (!navigator.mediaDevices?.getUserMedia) return "unavailable";
          return await Promise.race([
            navigator.mediaDevices.getUserMedia(\(constraints)).then(stream => {
              stream.getTracks().forEach(track => track.stop());
              return "GRANTED";
            }, error => error.name),
            new Promise(resolve => setTimeout(() => resolve("timeout"), 3000))
          ]);
          """, frame: frame)
        record(
          kind + " denied in " + label,
          absent
            ? outcome as? String == "unavailable"
            : outcome as? String == "NotAllowedError" && mediaDecisions > before,
          ["result": outcome, "callbacks": mediaDecisions - before])
      }
    }
    let beforeLocation = locationDecisions
    let location = try await asyncJS(
      view,
      """
      return await new Promise(resolve => {
        const deadline = setTimeout(() => resolve("timeout"), 3000);
        navigator.geolocation.getCurrentPosition(
          () => { clearTimeout(deadline); resolve("GRANTED"); },
          error => { clearTimeout(deadline); resolve(String(error.code)); },
          {timeout: 2000});
      });
      """, frame: frame)
    record(
      "location denied in " + label, location as? String == "1",
      [
        "result": location, "callbacks": locationDecisions - beforeLocation,
        "publicDelegateAvailable": ProcessInfo.processInfo.isOperatingSystemAtLeast(
          OperatingSystemVersion(majorVersion: 27, minorVersion: 0, patchVersion: 0)),
      ])
  }

  func asyncJS(_ view: WKWebView, _ source: String, frame: WKFrameInfo? = nil) async throws -> Any {
    try await withCheckedThrowingContinuation { continuation in
      view.callAsyncJavaScript(source, arguments: [:], in: frame, in: .page) {
        continuation.resume(with: $0)
      }
    }
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
    guard arguments.count == 4, let port = Int(arguments[1]), (1...65535).contains(port),
      ["zorvo", "usage-strings", "camera-only", "microphone-only"].contains(arguments[3])
    else {
      fputs("Usage: probe <fixture port> <result.json> <mode>\n", stderr)
      exit(1)
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let probe = Probe()
    app.delegate = probe
    app.run()
    withExtendedLifetime(probe) {}
  }
}
