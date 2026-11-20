# WKWebView browser spike

Standalone measurements for the [canonical engine note](../../docs/superpowers/specs/2026-11-20-browser-engine-design.md)
and [spike report](../../docs/superpowers/specs/2026-11-20-browser-wkwebview-spike-report.md).
Not built by Tauri, not installed in `/Applications`, and not shipped.
The report maps coverage and gaps to the note's spikes 1–10; a passing
standalone assessment does not certify those complete gates.

## Run

Requires macOS, the repository's Node dependencies and Xcode with the macOS
27 SDK for the public location callback. Both architectures compile with a
macOS 12 deployment target. Older macOS and Intel runtime remain untested;
the app's deployment target is unchanged. Reusing a prepared binary does
not require compiling it with the SDK again.

```sh
node experiments/browser-wk/run.mjs
node experiments/browser-wk/run.mjs --usage-strings
node experiments/browser-wk/run.mjs --camera-only
node experiments/browser-wk/run.mjs --microphone-only
```

The default `zorvo` bundle has no camera, microphone or location usage
description, matching `src-tauri/Info.plist`. The supplementary modes insert
the named camera/microphone strings into the temporary test bundle only.
Each snapshot has its own bundle identifier. The test launches with
`open -W -n` so it runs as its own application, instead of inheriting the
launching terminal or Codex app's privacy identity.

Prepare an app once, approve its OS permissions, then reuse the exact
signed binary for the canonical Screen Recording precondition:

```sh
node experiments/browser-wk/run.mjs --prepare
node experiments/browser-wk/run.mjs --prepare --usage-strings
# Use each printed snapshot directory separately:
node experiments/browser-wk/run.mjs --reuse '<snapshot directory>' --request-permissions
node experiments/browser-wk/run.mjs --reuse '<snapshot directory>'
```

Preparation uses a separate directory under
`~/Library/Application Support/Zorvo Browser Spike/`, with a build manifest
and LaunchServices registration. A rebuild gets a fresh identity. Reuse
checks the current and snapshotted sources, binary, plist, compiled fixture
and code signature before launch. It refuses a snapshot whose native
process is already running, without ending that process.

`--request-permissions` is an explicit setup step, with no page loaded and
no capture stream. It requests Screen Recording authorization and, in the
two-string mode only, camera/microphone OS authorization. The user approves
the OS dialogs; the script does not approve them. Setup writes
`permission-setup.json`, which is not an assessed result. Relaunch without
that flag to collect the page-denial tests. Reuse clears an older
`results.json` before collection so an interrupted run cannot retain stale
evidence. Revoke the temporary app's grants after collection.

Every view has ordinary JavaScript settings and a guarded
`WKPreferences._screenCaptureEnabled` setter/getter check before creation.
Missing selectors or a readback other than false fail the probe. The public
camera/microphone delegate denies on macOS 12+, and the public location
delegate denies on macOS 27+. Below 27 the same location request is still
made, and its actual result is recorded with the absence of that callback.
No Lockdown configuration or private display-capture permission delegate is
used. No capture stream is requested when the API is absent.

All modes check the secure top document plus fresh same-origin and
cross-origin frames. They record the actual API surface, WebAssembly and
dynamic JavaScript availability, and location error codes and callback
counts. The default and two-string modes also request camera/microphone
access and record the outcomes and native denial callback counts.
A request that times out never counts as a denial. The default expects
`navigator.mediaDevices` to be absent; the two-string mode expects
`getUserMedia` to exist and reach the denying delegate. The individual-string
modes observe which surface returns, without making media requests: the
undeclared device is not a supported capture configuration and can terminate
the process in TCC before the delegate. All modes require `getDisplayMedia`
to be absent. A failure to reach the media delegate stays a failed check.

The report records `CGPreflightScreenCaptureAccess()`. A false value creates
an unverified precondition check for canonical spike 7, which also requires
testing with Screen Recording granted. Regular collection never requests
system privacy grants. Only the explicit setup flag requests authorization,
separately from the tests.

## Background React test

The default mode also clicks a real React button in seven sequential states:
visible, view hidden, a fully covering native window, minimized, zero alpha,
offscreen within the window, and covered by an opaque sibling view. The
window is miniaturizable, and its actual minimized and occlusion states are
recorded.

Each condition records about five seconds of completed 100 ms timers,
animation callbacks and completed fetches from a 200 ms retry loop. Each
counter is rendered by React. A command snapshot must read the incremented
button state, and a native `takeSnapshot` must change within one second
of the click. Cropped before/after PNGs isolate the React counter from the
activity counters; their hashes and capture times are recorded.
The report distinguishes direct hidden/covered results from the same-window
cover fallback. It records CPU time and resident bytes for the host and main
view's WebContent PID, excluding GPU and other WebContent processes. These
are short local samples, not full-app memory or scrolling benchmarks.
Another Space and a fully integrated browser remain untested.

## Evidence and cleanup

The runner prints its temporary directory, saves native stdout/stderr, and
validates the complete selected check set. Empty, partial, duplicate,
malformed or mode-mismatched reports fail. Exit 0 means the named
observations passed, 2 means failed/unverified checks, and 1 means a harness
error. A failed canonical precondition or uncovered gate remains stated in
the spike report even when the narrower observation set passes.

Source files are copied into an immutable snapshot before compilation. The
compiled React fixture, native sources, plist, runner and validator are
hashed in every report, together with the architecture, deployment target,
Node version and actual bundle plist. SIGINT/SIGTERM abort the launch and
terminate only the recorded test PID after verifying its executable path.
The runner has a three-minute subprocess deadline. Its fixture connections
and listener close in `finally`; temporary source, app, PNGs and reports
remain available for inspection.

The loopback server serves only synthetic fixture routes and cookies on
`127.0.0.1`, at an OS-selected port, accepting that host and `localhost`.
It is temporary test infrastructure; ordinary browser navigation needs no
HTTP server and no background terminal task.

```sh
node --test experiments/browser-wk/report.test.mjs experiments/browser-wk/fixture.test.mjs experiments/browser-wk/scroll/timing.test.mjs
pnpm test
```

CI runs the Node suites separately. Vitest excludes `experiments/**`
because these suites use `node:test`. A Vitest guard keeps device usage
strings out of the real app and ordinary probe plist.

The named content world separates script globals; the DOM remains shared
and page controlled. Typed fill data and a hostile page's replacement of
globals, `document.querySelector`, `Element.prototype.matches` and
`JSON.stringify` exercise that boundary. The frame-identity handler lives
only in that world. This Swift probe does not prove wry's IPC wiring,
production element references or Rust message validation.

Current reports belong in `results/2026-11-20-*.json`. Earlier public,
screen-SPI and restricted-mode results remain in
[`results/historical/`](results/historical/) with their original source
hashes. They are superseded evidence and are not assessments of the
selected policy. The [renderer workload](scroll/README.md) separately
measures scripted animation; native trackpad parity is still unmeasured.
