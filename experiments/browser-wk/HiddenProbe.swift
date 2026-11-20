import AppKit
import CryptoKit
import Darwin
import WebKit

extension Probe {
  func activity(_ view: WKWebView) async throws -> [String: Double] {
    let values = try await js(view, "({...globalThis.probeActivity})") as? [String: NSNumber] ?? [:]
    guard values.count == 4 else {
      throw ProbeFailure("The activity fixture returned incomplete counters.")
    }
    return values.mapValues(\.doubleValue)
  }

  func processSamples(_ view: WKWebView) -> [[String: Double]] {
    var pids = [getpid()]
    let selector = NSSelectorFromString("_webProcessIdentifier")
    if view.responds(to: selector) {
      typealias GetPID = @convention(c) (AnyObject, Selector) -> Int32
      let getter = unsafeBitCast(view.method(for: selector), to: GetPID.self)
      let pid = getter(view, selector)
      if pid > 0 { pids.append(pid) }
    }
    return pids.compactMap { pid in
      var info = proc_taskinfo()
      let count = proc_pidinfo(
        pid, PROC_PIDTASKINFO, 0, &info, Int32(MemoryLayout.size(ofValue: info)))
      guard count == MemoryLayout.size(ofValue: info) else { return nil }
      return [
        "pid": Double(pid), "cpuNanoseconds": Double(info.pti_total_user + info.pti_total_system),
        "residentBytes": Double(info.pti_resident_size),
      ]
    }
  }

  func capture(_ view: WKWebView, name: String, deadline: Double = 1) async -> [String: Any] {
    let configuration = WKSnapshotConfiguration()
    configuration.rect = NSRect(x: 0, y: 0, width: 340, height: 90)
    configuration.afterScreenUpdates = true
    let started = ProcessInfo.processInfo.systemUptime
    return await withCheckedContinuation { continuation in
      var settled = false
      let timeout = DispatchWorkItem {
        guard !settled else { return }
        settled = true
        continuation.resume(returning: ["error": "snapshot deadline", "elapsedMs": deadline * 1000])
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + deadline, execute: timeout)
      view.takeSnapshot(with: configuration) { image, error in
        guard !settled else { return }
        settled = true
        timeout.cancel()
        do {
          guard let image,
            let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
            let data = NSBitmapImageRep(cgImage: cgImage).representation(
              using: .png, properties: [:])
          else { throw error ?? ProbeFailure("WebKit returned an empty snapshot.") }
          let root = URL(fileURLWithPath: self.args[2]).deletingLastPathComponent()
          try data.write(to: root.appendingPathComponent(name + ".png"))
          let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
          continuation.resume(returning: [
            "file": name + ".png", "sha256": digest, "width": cgImage.width,
            "height": cgImage.height,
            "elapsedMs": (ProcessInfo.processInfo.systemUptime - started) * 1000,
          ])
        } catch {
          continuation.resume(returning: ["error": String(describing: error)])
        }
      }
    }
  }

  func measureHiddenActivity(_ view: WKWebView) async throws {
    let originalFrame = view.frame
    var measurements: [[String: Any]] = []
    var coverWindow: NSWindow?
    var coverView: NSBox?
    defer {
      coverWindow?.close()
      coverView?.removeFromSuperview()
      view.isHidden = false
      view.alphaValue = 1
      view.frame = originalFrame
      window.deminiaturize(nil)
      window.makeKeyAndOrderFront(nil)
    }

    var modes = [
      "visible", "hidden", "covered", "minimized", "zero-alpha", "offscreen", "same-window-cover",
    ]
    if longHidden { modes += ["hidden-after-idle", "minimized-after-idle"] }
    for mode in modes {
      coverWindow?.close()
      coverWindow = nil
      coverView?.removeFromSuperview()
      coverView = nil
      window.deminiaturize(nil)
      window.makeKeyAndOrderFront(nil)
      view.isHidden = false
      view.alphaValue = 1
      view.frame = originalFrame
      try await pause(200)
      switch mode {
      case "hidden", "hidden-after-idle": view.isHidden = true
      case "covered":
        let cover = NSWindow(
          contentRect: window.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        cover.isReleasedWhenClosed = false
        cover.backgroundColor = .windowBackgroundColor
        cover.order(.above, relativeTo: window.windowNumber)
        coverWindow = cover
      case "minimized", "minimized-after-idle": window.miniaturize(nil)
      case "zero-alpha": view.alphaValue = 0
      case "offscreen": view.frame.origin.x = -1600
      case "same-window-cover":
        let cover = NSBox(frame: originalFrame)
        cover.boxType = .custom
        cover.borderWidth = 0
        cover.fillColor = .windowBackgroundColor
        window.contentView!.addSubview(cover, positioned: .above, relativeTo: view)
        coverView = cover
      default: break
      }
      try await pause(300)
      let beforeImage = await capture(view, name: mode + "-before")
      let beforeState = try await command(view, ["operation": "snapshot"]) as? [String: Any] ?? [:]
      let expected = String((Int(beforeState["state"] as? String ?? "") ?? -1) + 1)
      var quietWindow: [String: Any] = [:]
      var quietDuration: Double = 0
      if mode.hasSuffix("-after-idle") {
        let quietStarted = ProcessInfo.processInfo.systemUptime
        print("QUIET \(mode): 180 seconds without page commands")
        fflush(stdout)
        try await pause(180_000)
        quietDuration = (ProcessInfo.processInfo.systemUptime - quietStarted) * 1000
        quietWindow =
          try await js(view, "globalThis.probeRecentActivity()") as? [String: Any] ?? [:]
      }
      let before = try await activity(view)
      let resourcesBefore = processSamples(view)
      let started = ProcessInfo.processInfo.systemUptime
      _ = try await command(view, ["operation": "click", "selector": "#react-click"])
      var observed = ""
      repeat {
        let result = try await command(view, ["operation": "snapshot"]) as? [String: Any] ?? [:]
        observed = result["state"] as? String ?? "missing"
        if observed == expected { break }
        try await pause(10)
      } while ProcessInfo.processInfo.systemUptime - started < 1
      let stateLatency = (ProcessInfo.processInfo.systemUptime - started) * 1000
      let deadline = max(0.01, 1 - (ProcessInfo.processInfo.systemUptime - started))
      let afterImage = await capture(view, name: mode + "-after", deadline: deadline)
      let visualLatency = (ProcessInfo.processInfo.systemUptime - started) * 1000
      let remaining = 5 - (ProcessInfo.processInfo.systemUptime - started)
      if remaining > 0 { try await pause(UInt64(remaining * 1000)) }
      let after = try await activity(view)
      let elapsed = ProcessInfo.processInfo.systemUptime - started
      let resourcesAfter = processSamples(view)
      let cpu = resourcesAfter.compactMap { current -> Double? in
        guard let baseline = resourcesBefore.first(where: { $0["pid"] == current["pid"] }),
          let initial = baseline["cpuNanoseconds"], let final = current["cpuNanoseconds"]
        else { return nil }
        return 100 * (final - initial) / (elapsed * 1_000_000_000)
      }.reduce(0, +)
      let changed =
        beforeImage["sha256"] as? String != nil
        && afterImage["sha256"] as? String != nil
        && beforeImage["sha256"] as? String != afterImage["sha256"] as? String
      let reactionPassed =
        observed == expected && stateLatency <= 1000 && visualLatency <= 1000 && changed
      let documentHidden = try await js(view, "document.hidden") as? Bool ?? true
      measurements.append([
        "mode": mode, "elapsedMs": elapsed * 1000, "documentHidden": documentHidden,
        "quietDurationMs": quietDuration, "lastFiveSecondsOfQuiet": quietWindow,
        "windowVisible": window.occlusionState.contains(.visible),
        "windowMiniaturized": window.isMiniaturized,
        "timeouts": (after["timeouts"] ?? 0) - (before["timeouts"] ?? 0),
        "intervals": (after["intervals"] ?? 0) - (before["intervals"] ?? 0),
        "animationFrames": (after["animationFrames"] ?? 0) - (before["animationFrames"] ?? 0),
        "fetches": (after["fetches"] ?? 0) - (before["fetches"] ?? 0),
        "expectedState": expected, "snapshotState": observed, "stateLatencyMs": stateLatency,
        "visualLatencyMs": visualLatency, "reactAndSnapshotWithinOneSecond": reactionPassed,
        "beforeImage": beforeImage, "afterImage": afterImage,
        "resources": [
          "scope":
            "Host and the main view's WebContent PID; GPU and other WebContent processes excluded",
          "cpuPercentOfOneCore": cpu, "before": resourcesBefore, "after": resourcesAfter,
        ],
      ])
      print("ACTIVITY \(mode) measured")
      fflush(stdout)
    }
    let hidden = measurements.filter {
      ["hidden", "covered", "minimized"].contains($0["mode"] as? String ?? "")
    }
    let direct =
      hidden.count == 3
      && hidden.allSatisfy {
        $0["reactAndSnapshotWithinOneSecond"] as? Bool == true
          && $0["documentHidden"] as? Bool == true
          && ($0["mode"] as? String != "minimized" || $0["windowMiniaturized"] as? Bool == true)
          && ($0["mode"] as? String != "covered" || $0["windowVisible"] as? Bool == false)
      }
    let fallback =
      measurements.first { $0["mode"] as? String == "same-window-cover" }?[
        "reactAndSnapshotWithinOneSecond"] as? Bool == true
    record("hidden lifecycle measurements", measurements.count == modes.count, measurements)
    record("hidden React interaction", direct, ["hiddenCoveredAndMinimizedPass": direct])
    record("visible-window fallback interaction", fallback, ["sameWindowCoverPass": fallback])
    if longHidden {
      let delayed = measurements.filter { ($0["mode"] as? String ?? "").hasSuffix("-after-idle") }
      let passed =
        delayed.count == 2
        && delayed.allSatisfy {
          $0["reactAndSnapshotWithinOneSecond"] as? Bool == true
            && $0["documentHidden"] as? Bool == true
            && ($0["quietDurationMs"] as? Double ?? 0) >= 180_000
            && ($0["mode"] as? String != "minimized-after-idle"
              || $0["windowMiniaturized"] as? Bool == true)
        }
      record("long hidden React interaction", passed, delayed)
    }
  }
}
