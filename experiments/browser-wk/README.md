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

For a direct-child comparison, use `--direct`. The same prepared signed
binary can be tested through both paths. Its report names the parent and
responsible application (a guarded diagnostic SPI), without recording their
paths. Direct launch records the usage-string boundary separately from the
denial result. For this third capture run, an authorized parent must expose
`mediaDevices` and `getUserMedia`; absent APIs cannot satisfy it. The screen
API must still be absent and each media request must reach the public denying
delegate. The current direct recording identifies ChatGPT/Codex as responsible,
with camera and microphone authorization active. A parent without those grants
does not exercise this launch condition.

Prepare an app once, approve its OS permissions, then reuse the exact
signed binary for the canonical Screen Recording precondition:

```sh
node experiments/browser-wk/run.mjs --prepare
node experiments/browser-wk/run.mjs --prepare --usage-strings
# Use each printed snapshot directory separately:
node experiments/browser-wk/run.mjs --reuse '<snapshot directory>' --request-permissions
node experiments/browser-wk/run.mjs --reuse '<snapshot directory>'
node experiments/browser-wk/run.mjs --reuse '<snapshot directory>' --direct
node experiments/browser-wk/run.mjs --reuse '<snapshot directory>' --long-hidden
```

Preparation uses a separate directory under
`~/Library/Application Support/Zorvo Browser Spike/`, with a build manifest
and LaunchServices registration. A rebuild gets a fresh identity. Reuse
checks the snapshotted sources, binary, plist, compiled fixture and code
signature before launch. It refuses a snapshot whose native
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
an independently started 100 ms `setInterval`, animation callbacks and
completed fetches from a loop that schedules a 200 ms timer after each
awaited response. These are four different scheduling paths. Each
counter is rendered by React. A command snapshot must read the incremented
button state, and a native `takeSnapshot` must change within one second
of the click. Cropped before/after PNGs isolate the React counter from the
activity counters; their hashes and capture times are recorded.
The hidden gate requires hidden, covered and minimized observations; a
separate gate reports the same-window cover fallback. A fallback success
cannot hide a direct failure. On macOS 27 the location gate also requires
exactly one public callback per realm; below 27 it requires zero.

`--long-hidden` adds two more conditions. Each leaves the hidden or minimized
view alone for 180 seconds, without any native page commands, then repeats
the click and snapshots. A bounded page-side history records every counter
update and supplies the final five seconds of the quiet period before the
first command. The report also retains the usual five seconds after the
click. Quiet duration and actual visibility flags are recorded; the long
gate is independent of the short and fallback gates.

The report records CPU time and resident bytes for the host and main
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
hashed in every report, with the source commit, architecture, deployment
target, Node version and actual bundle plist. Collection requires committed
probe sources. A reused binary retains its original `sourceCommit` and hashes;
`collectorCommit` and `collectorSources` identify the runner used for that
collection, and from this commit on the checkout's validator beside it. LaunchServices resolution is a boolean and a snapshot-relative
two-component path; no collector home path is recorded.
SIGINT/SIGTERM abort the launch and
terminate only the recorded test PID after verifying its executable path.
The runner has a three-minute launch deadline, or nine minutes for the
long-hidden collection. Script replies have a five-second native deadline.
Fixture connections and listeners close in `finally`. A temporary collection
unregisters its app with LaunchServices there, failed runs included, and so
does a reuse of a directory outside the prepared root. A prepared snapshot
keeps its registration through permission setup, every reuse and the
revocation of its grants, until `--clean` removes it. Files remain available
as evidence until explicitly cleaned.

After exporting results and revoking any test grants, remove a prepared app:

```sh
node experiments/browser-wk/run.mjs --clean '<snapshot directory>'
```

Cleanup checks the root, snapshot name and manifest, refuses symlinks and a
running native process, unregisters the exact app, then deletes only that
snapshot. An already-absent LaunchServices entry (`-10814`) permits cleanup;
other unregister failures preserve its files. The command cannot
remove an arbitrary directory, a temporary collection outside the prepared
root, or an installed application. It does not revoke OS grants itself;
revoke those before unregistering and deleting a permission-test app.

The loopback server serves only synthetic fixture routes and cookies on
`127.0.0.1`, at an OS-selected port, accepting that host and `localhost`.
It is temporary test infrastructure; ordinary browser navigation needs no
HTTP server and no background terminal task.

```sh
node --test experiments/browser-wk/report.test.mjs experiments/browser-wk/fixture.test.mjs experiments/browser-wk/snapshot.test.mjs experiments/browser-wk/scroll/timing.test.mjs
pnpm vitest run src/test/browser-permission-boundary.test.ts
```

CI runs the Node suites separately. Vitest excludes `experiments/**`
because these suites use `node:test`. The app's Vitest guard reads only
`src-tauri/Info.plist`; the experiment's Node suite checks its own plist.
CI validates report structure, assessment and attachments. Hashes remain
facts about the named source commit, without being compared with the current
checkout. Editing the probe does not require collecting historical evidence
again. Schema 1 recordings retain their original gate set; schema 2 separates
hidden/fallback gates and validates the location callback counts. Schema 3
also checks the API expectation for the launch path, including the required
inherited media API in the authorized direct-child case.

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


Schema 4 reports real quiet-history spans and oldest-sample age; a trailing
window outside 5000–6500 ms does not pass. Direct runs without inherited media
APIs are unverified rather than failed denials, and only inherited-authorized
devices are requested. Prepared apps stay registered after permission setup and
reuse until `--clean`, so approval and later revocation can resolve the identity.
A reuse result must match the requested launch/long-hidden flags and pass both
the snapshot and current assessments. All seven linked recordings are required
by the tests, with explicit modes and schema versions.
