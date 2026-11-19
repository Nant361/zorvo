# WKWebView browser spike

Standalone evidence for [the browser design](../../docs/superpowers/specs/2026-11-20-browser-wkwebview-design.md).
Not built by Tauri, not installed in `/Applications`, and not shipped.
Requires macOS, Node and Xcode with the macOS 27 SDK to compile the public
geolocation callback. The binary targets macOS 12; requests to the geolocation
API are skipped below 27 and recorded as unverified.

```sh
node experiments/browser-wk/run.mjs
node experiments/browser-wk/run.mjs --screen-spi
```

The first run uses public permission delegates only. The second enables two
private display-capture delegate selectors for diagnosis. The public run is
expected to fail the screen denial gate on the tested OS. The diagnostic run
does not establish that SPI can ship or work on another WebKit version.

A temporary app opens after compilation. Click **Request screen**, cancel any
picker or system prompt without granting access, scroll the page, then click
**Finish checks**. The fixture records whether the click was trusted and had
user activation. A prompt or a user cancellation never counts as an automatic
denial. The test does not select a capture surface or record a screen stream.
Camera, microphone and location requests are denied by the test delegates.

The runner prints the JSON report path under the OS temporary directory.
It returns 2 if anything fails or remains unverified, including the full scroll
performance comparison that this spike does not perform. A successful compile
or a passing subset never produces an overall green result. It returns 1 for
a runner error. The app waits for interaction for at most two minutes; the
runner has a three-minute subprocess deadline. SIGINT/SIGTERM abort the child
and close the fixture. App and report files remain as inspection artifacts.

The server binds only `127.0.0.1` on an OS-selected port and serves only a
synthetic page and synthetic cookies. It is intentionally temporary test
infrastructure; regular browser navigation needs no HTTP server. The runner
closes it in `finally`, including compilation, startup or test failures.

The named content world is a JavaScript-variable boundary. The DOM is shared
and still controlled by the page. The example dispatcher and its two operations
are probes, not a production snapshot engine or ref implementation.

Recorded runs on macOS 27.0.1, arm64:

- [Public delegates](results/2026-11-20-public.json): screen denial failed; scroll performance unverified.
- [Diagnostic screen SPI](results/2026-11-20-screen-spi.json): screen denial passed; scroll performance unverified.

Both reports include hashes of the exact Swift source and fixture. Their
small frame samples are not evidence of parity with OpenCode. Intel compilation
also passed, but no Intel runtime or older macOS runtime was tested.
