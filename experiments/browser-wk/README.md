# WKWebView browser spike

Standalone evidence for [the browser design](../../docs/superpowers/specs/2026-11-20-browser-wkwebview-design.md).
Not built by Tauri, not installed in `/Applications`, and not shipped.
Requires macOS, Node and Xcode with the macOS 27 SDK to compile the public
geolocation callback. The binary targets macOS 12; requests to the geolocation
API are skipped below 27 and recorded as unverified.

```sh
node experiments/browser-wk/run.mjs
node experiments/browser-wk/run.mjs --screen-spi
node experiments/browser-wk/run.mjs --restricted
```

The default run uses public permission delegates. On the tested OS it leaves
screen capture pending after a trusted click. The second run enables private
display-capture delegate selectors for diagnosis. The third uses the public
per-view Lockdown Mode preference and runs automatically. The modes are
mutually exclusive. Restricted mode requires macOS 13 or newer and fails
before opening a view on an older runtime.

With the per-view restriction active on this Mac, capture APIs are absent in
the secure top document and newly loaded same-origin and cross-origin iframes.
The public geolocation callback explicitly denies location in all three. Navigation,
hidden-tab commands, isolated scripts and session cookies still pass. This
setting applies only to the test views. It does not change system Lockdown Mode.

Apple documents performance and compatibility costs for
[the per-view preference](https://developer.apple.com/documentation/webkit/wkwebpagepreferences/islockdownmodeenabled).
Its effects extend beyond capture, including JavaScript execution. It needs
review as a browser policy and tests on older supported OS versions before
production integration.

A temporary app opens after compilation. For the first two modes, click **Request screen**, cancel any
picker or system prompt without granting access, scroll the page, then click
**Finish checks**. The fixture records whether the click was trusted and had
user activation. A prompt or a user cancellation never counts as an automatic
denial. The test does not select a capture surface or record a screen stream.
Camera, microphone and location requests are denied by the test delegates.

The runner prints the JSON report path under the OS temporary directory.
It validates the complete set of checks for the selected mode before assessing
the report. Empty, partial, duplicate or malformed results fail validation.
The report records its assessment scope. It returns 2 if a recorded check fails
or remains unverified. The interactive
modes include an unverified scroll-performance gate. Restricted mode tests
only permissions and isolation and can return 0 for those checks on macOS 27.
The [separate renderer workload](scroll/README.md) measures scripted scrolling
and chat updates. Trackpad parity and full-app performance require integration
tests. It returns 1 for a runner error. The app waits for interaction for at most two minutes; the
runner has a three-minute subprocess deadline. SIGINT/SIGTERM abort the child
and close the fixture. App and report files remain as inspection artifacts.

The server binds only `127.0.0.1` on an OS-selected port and serves only a
synthetic page and synthetic cookies. It is intentionally temporary test
infrastructure; regular browser navigation needs no HTTP server. The runner
closes it in `finally`, including compilation, startup or test failures.
Active fixture connections are closed during teardown as well. The fixture
accepts only GET requests for its declared routes with the selected loopback
port and either the `127.0.0.1` or `localhost` host.

The runner copies the Swift source, fixture, plist and runner modules into its
temporary output directory before compilation. It compiles that Swift snapshot
and loads that fixture and validator snapshot. Report hashes identify the
snapshots, so editing the checkout during a long test cannot change the sources
the report attributes to the run. Node version and compilation target are recorded.

Run the regression checks for report validation and fixture request handling.

```sh
node --test experiments/browser-wk/report.test.mjs experiments/browser-wk/fixture.test.mjs
```

The named content world is a JavaScript-variable boundary. The DOM is shared
and still controlled by the page. The example dispatcher and its two operations
are probes, not a production snapshot engine or ref implementation.

Recorded runs on macOS 27.0.1, arm64:

- [Public delegates](results/2026-11-20-public.json): screen denial failed; scroll performance unverified.
- [Diagnostic screen SPI](results/2026-11-20-screen-spi.json): screen denial passed; scroll performance unverified.
- [Public per-view restriction](results/2026-11-20-restricted.json) passes ten permission and isolation checks on macOS 27.0.1. It uses no display-capture SPI.

Reports include hashes of the exact Swift source and fixture. The default
report was collected from commit `4aa6cc8c`. The restricted and SPI reports use
the snapshotted source in this change. The renderer comparison was collected
from `01d6063b`, as verified by its manifest. Their small frame samples do not measure trackpad
parity with OpenCode. Intel compilation passes, while Intel runtime and older
macOS runtime coverage remain open.

The restricted probe records native frame identities through a diagnostic
handler in the isolated content world. The page-world check verifies that
this handler remains inaccessible there. This permits native evaluation in a
cross-origin frame without trusting page messages about its capabilities.

The current SPI run repeats a trusted native screen-request click with ordinary
JavaScript settings. Camera, microphone and screen each require their own
native denial callback to count as passing. Location is explicitly denied as
well. Its native scroll smoke check passes and its separate performance check
remains unverified, so the runner correctly exits with status 2. CI runs the
report-validation and loopback-fixture regression tests on Linux.
