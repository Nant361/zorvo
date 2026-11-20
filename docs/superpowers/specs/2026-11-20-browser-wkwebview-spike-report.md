# WKWebView browser spike report

Measured on 2026-11-20, macOS 27.0.1 (26A434), arm64. The
[canonical browser engine note](2026-11-20-browser-engine-design.md) is the
reference for the engine decision, gate criteria and open questions. This
report maps the standalone experiment to that note's spikes 1–10; it is
input to a later feature spec.

**The engine gates are not all certified.** The ordinary Zorvo configuration
removes the capture API in all three tested realms, and the React interaction
test passes hidden, covered and minimized. The test app has no Screen
Recording grant, the supplementary media-delegate test does not complete,
and the required older-OS run is unavailable. wry/Rust integration, real-page
snapshots and the other gaps below remain work before feature implementation.

The branch is rebased on main, including the merged #257, #258 and #259.
The former CEF implementation is retired. The current change ships no
browser engine, app entitlement or UI. The application's minimum macOS
version is unchanged; the canonical browser minimum is macOS 12 at runtime.

## Results by canonical spike

| Spike | What this probe shows | What remains |
| --- | --- | --- |
| **1. Store per session — partial** | Three independently configured Swift views use two non-persistent stores. Two views share `alpha`; the other session cannot read or overwrite it and retains `beta`. | The wry configuration path, `window.open`, scripts installed once, IPC after closing a sibling tab and absence of disk remnants. No store-by-identifier fallback is selected here. |
| **2. Script boundary — partial** | Typed fill data remains literal. A forged global plus replacements of `document.querySelector`, `Element.prototype.matches` and `JSON.stringify` leave the isolated snapshot's input and serialized proof intact. The page cannot reach the isolated native frame handler. | This is Swift, not Rust. wry's IPC and Rust checks, hostile navigation generations and production element references remain untested. The DOM is shared and untrusted. |
| **3. Hidden tab — observed pass for the standalone React case** | A scripted click changes React state and both the command snapshot and native image show the increment within one second, hidden, covered and minimized. Seven conditions measure timers, RAF, fetch, CPU and resident memory below. | Integration with the app, another Space, more page workloads and sustained cost. Hidden/minimized RAF stops; visible-window fallback measurements are below, with their limits. |
| **4. Usable snapshot — not exercised** | The local React fixture and native identities for same-origin and cross-origin frames are available. | The five real pages, accessible control names, open shadow roots, a full tree and references surviving until navigation. The probe's small state object is not that snapshot engine. |
| **5. Input — partial** | An isolated-world native value setter and input event update a real React controlled input; button clicks trigger a React re-render. | A native `select` and sites that reject script events. These events do not become trusted user input. |
| **6. Looping page — not exercised** | Normal temporary-app and loopback-fixture teardown is checked. | Five live tabs, `while (true) {}`, responsive Zorvo, ending that tab's WebContent process and memory reclamation. Normal exit does not prove this gate. |
| **7. No capture — partial, not passed** | Zorvo-matching plist; ordinary JavaScript; guarded screen preference disabled before all three view creations. No `mediaDevices` in the top document or either iframe. Location returns permission error 1 through one public denial callback per realm. | Own Screen Recording grant, successful supplementary public media-denial callbacks, and an actual runtime below macOS 27. Current failed/unverified results stay visible in the reports. |
| **8. What loads — partial** | The fixture loads HTTP on both `127.0.0.1` and `localhost`. | The note's public HTTPS, public HTTP and `app.test` cases, under the real app's ATS policy. |
| **9. Dialogs and file picker — not exercised** | No dialogs or file picker are implemented by this probe. | User and agent clicks, and outcomes for alert, confirm, prompt and file input. |
| **10. Artifact/browser coexistence — not exercised** | The experiment is a separate native app. | Inspector placement coordination, switching between artifacts and browser, overlays and composer focus. |

Spikes 1, 2, 3 and 7 are the canonical gate. Partial coverage above does not
turn them into accepted implementation results.

## Permission configuration and reports

The default plist has no camera, microphone or location usage description.
A Vitest guard also protects the real `src-tauri/Info.plist`. Before every
view is created, the probe checks the screen preference's setter and getter
with `responds(to:)`, sets false and reads false back. Missing selectors or a
failed readback end the probe. Camera/microphone use the public denial
delegate; location uses its public macOS 27 callback. On older systems the
same location request is made and its actual error recorded, with no
claim that the callback exists there.

No Lockdown configuration or private display-capture permission delegate is
used in this probe. All three realms retain `WebAssembly` and dynamic
JavaScript. The single-description diagnostics answer a previously open
question: either description alone restores `mediaDevices` on this Mac.
They inspect the API and location only. A request for an undeclared device
is not part of these diagnostics.

| Bundle declarations | mediaDevices, all three realms | getUserMedia | getDisplayMedia | Location |
| --- | --- | --- | --- | --- |
| None, matching Zorvo | undefined | undefined | undefined | error 1; one public callback per realm |
| Camera and microphone | object | function | undefined | error 1; one public callback per realm |
| Camera only | object | function | undefined | error 1; one public callback per realm |
| Microphone only | object | function | undefined | error 1; one public callback per realm |

The current reports all validate their complete, mode-specific check sets:

- [Zorvo configuration](../../../experiments/browser-wk/results/2026-11-20-public.json):
  21 passing observations and one unverified Screen Recording precondition.
- [Both descriptions](../../../experiments/browser-wk/results/2026-11-20-usage-strings.json):
  the display API remains absent, but all six media requests time out after
  three seconds with zero media-delegate callbacks. The report correctly
  fails; a timeout is not a denial.
- [Camera only](../../../experiments/browser-wk/results/2026-11-20-camera-only.json)
  and [microphone only](../../../experiments/browser-wk/results/2026-11-20-microphone-only.json):
  13 passing API/isolation/location observations each and the unverified
  Screen Recording precondition. No media requests or public media-denial
  claim in these modes.

All four bundles report `screenRecordingGranted: false`; camera and
microphone OS authorization remains `not determined`. The both-description
run has visible documents and a focused top document, so this is not
presented as a successful hidden-request test. The reason that those media
requests do not reach the delegate still needs isolation; the missing OS
grants are a relevant precondition, not proof of its cause. No privacy grant
was changed and no captured stream was obtained.

The tests launch via LaunchServices as independent applications. A direct
child launch earlier in diagnosis inherited the launching app's privacy
context and exposed APIs even without descriptions, so that run is not used
as evidence for Zorvo's bundle policy. Source and bundle hashes, launch mode,
OS authorizations, assessment scope and deployment target accompany the
current reports. Intel compilation passes with a macOS 12 target; Intel
runtime and any runtime below 27 remain unverified.

The earlier [public, screen-SPI and restricted reports](../../../experiments/browser-wk/results/historical/)
retain their original hashes as historical evidence. They are superseded
configurations, not validation of the selected policy. CI now checks the
current reports against the committed native source, fixture, plist,
runner and validator so a stale public report fails.

## Hidden and covered React measurements

One sequential run; each condition lasts about five seconds. The page
renders a 100 ms timeout counter, an animation-frame counter and completed
fetches from a loop with a 200 ms delay. Counts measure progress over the
actual recorded interval, not a promised background frequency.

| View/window state | Seconds | Timeouts | RAF | Fetch completions | Click to updated native snapshot | Host + main WebContent CPU, one core | Resident MiB at end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Visible | 5.14 | 49 | 308 | 25 | 5.5 ms | 0.43% | 154.7 |
| View hidden | 5.33 | 5 | 0 | 17 | 9.4 ms | 0.08% | 148.5 |
| Native window fully covering it | 5.33 | 8 | 6 | 17 | 4.6 ms | 0.09% | 149.2 |
| Window minimized | 5.34 | 5 | 0 | 16 | 45.9 ms | 0.06% | 146.3 |
| View at zero alpha | 5.04 | 48 | 302 | 25 | 3.9 ms | 0.39% | 139.3 |
| View offscreen inside the window | 5.32 | 51 | 319 | 26 | 4.3 ms | 0.39% | 148.1 |
| Opaque sibling view covering it | 5.33 | 52 | 320 | 26 | 4.2 ms | 0.37% | 157.8 |

The minimized flag is true in that row, and the fully covered window has no
visible occlusion state. Native before/after crops show the counter changing
[1 to 2 while hidden](../../../experiments/browser-wk/results/2026-11-20-background/hidden-after.png),
[2 to 3 while covered](../../../experiments/browser-wk/results/2026-11-20-background/covered-after.png)
and [3 to 4 while minimized](../../../experiments/browser-wk/results/2026-11-20-background/minimized-after.png).
Their corresponding before images are in the same folder, and CI verifies
all six image hashes against the native report.

**Background behavior:** the tested React click and snapshot work directly,
but hidden/minimized views pause RAF and throttle timers to about once a
second. A wait that depends on animation frames cannot assume progress
there. Zero alpha, offscreen placement and a same-window cover retained
roughly 60 RAF callbacks/s in this run, providing candidates when such
progress is required. They were measured with the host window visible;
they do not demonstrate foreground-rate scheduling while that window is
minimized or on another Space. The feature spec must account for that limit.

The CPU values sum process CPU-time deltas for the host and the main view's
WebContent PID over the recorded interval. Resident memory is a point
sample of the same PIDs. GPU and other WebContent processes are excluded,
and WebContent may be shared. The process samples do not establish
incremental memory cost or total Zorvo resource use. These short sequential
samples justify neither engine parity nor a sustained performance claim.

## Renderer scheduling and native scroll

The [separate renderer fixture](../../../experiments/browser-wk/scroll/README.md)
uses the actual ChatCanvas and local ACP reducer updates, with four
20-second rounds per host and no model requests. Its existing raw samples
have been summarized again against each round's own median:

| Host/layout | RAF rate | Median interval | Idle / streaming p95 | Intervals >1.5× own median, rounds 1–4 | Total / samples |
| --- | --- | --- | --- | --- | --- |
| OpenCode 2.3.2 | about 120/s | 8.3 ms | 9.2–9.3 / 9.2–9.3 ms | 0, 1, 0, 4 | 5 / 9,596 (0.052%) |
| Default WK view | about 60/s | 17 ms | 19 / 19 ms | 3, 0, 2, 1 | 6 / 4,796 (0.125%) |
| Restricted document, separate chat | about 60/s | 17 ms | 18 / 18 ms | 0, 1, 5, 0 | 6 / 4,796 (0.125%) |

These p95 values primarily record different callback scheduling rates,
not work per frame or WebKit running twice as slowly. All three have few
delayed callbacks at their own cadence. Counts over 1.5 times the median
are not an exact count of missed display refreshes. On the 120 Hz display
WebKit's default script animation runs near 60 frames/s; changing that
default has no known public API. Native scrolling takes a separate path
and is still unmeasured.

The split-layout row uses the earlier Lockdown configuration and is
historical renderer data, not a performance test of the selected ordinary
configuration. The [summary](../../../experiments/browser-wk/results/2026-11-20-scroll.json)
preserves raw-data and fixture hashes and now identifies the summary
scripts too. Unit tests cover relative thresholds at both 60 and 120 Hz.

Before replacing a local app build, compare sustained native trackpad input,
momentum, resize and menus, full-app process costs and streaming ACP work
under matched conditions. The current measurements do not answer the
user's native-scroll comparison with OpenCode. The installed app is not
replaced by this spike PR.

## Proposed boundary and lifetime

Input for the feature spec, subject to the canonical note's section 5.

- The native view is created directly, outside Tauri's managed webviews. It
  receives no invoke key, app credentials, file protocol or Tauri IPC script.
  Only HTTP(S) navigation is accepted; reject file, javascript, data, custom
  scheme and external-application launches, including redirects and popups.
- One retained non-persistent `WKWebsiteDataStore` per app session, reused by
  its tabs. Do not equate `with_incognito(true)` per tab with this: wry 0.57
  creates a new non-persistent store for each such view. The adapter must
  install the shared store before WKWebView creation and test that path.
- Keep ordered tab records and an explicit active id. Closing the final tab,
  deleting the session or quitting releases views, store references, captures
  and grants. Limits apply to live sessions/tabs, not historical ids. Limit
  hit returns an error; it never evicts another session silently.
- Move/hide the same child view for bounds changes, Inspector tab changes
  and overlays. Do not recreate it for a scroll or UI render. Match existing
  artifact rules for finite bounds, overlay coverage and sequential IPC.
- Agent reads, screenshots and console access preserve the Inspector selection.
  A direct user Open/Show action reveals the page. Keep reveal actions separate
  from engine operations.
- Views and WebKit callbacks stay on the main thread; other work and waiting
  must not block it. Every pending operation has a deadline and rejects on
  close, crash or navigation where relevant. No periodic message pump.

## First agent operations and permission

Only tabs, navigate, back, forward, reload, wait, snapshot, find, evaluate, screenshot, click, fill,
select, check, scroll and console are in scope. The old operation names and
schemas are reference material, not evidence these are implemented on WebKit.
Network inspection, upload/download, trace, CPU profiling, heap and Lighthouse
are deferred. Unsupported operations return explicit errors.

Before any agent browser operation, including listing tabs, a session gets
an ordinary Zorvo permission request. Denial creates no view and executes no
operation. A grant belongs only to that session, ends with it and is cleared
on shutdown. Browser access is separate from artifact access and does not
implicitly allow a file upload or device permission. The grant must precede
resource allocation, also under concurrent calls and cancellation.

Internal commands are fixed functions in a named content world with typed,
JSON-compatible arguments passed through `callAsyncJavaScript`. Element refs
are kept in trusted state with a tab/frame/navigation generation; no
page-visible attribute is authority. Reject stale refs and cross-tab refs.
The page and DOM are still untrusted. [Content worlds separate variables,
not the DOM](https://developer.apple.com/documentation/webkit/wkcontentworld).

The explicit `evaluate` operation executes the agent's expression in the
page world after the grant. Never interpolate that expression into an
internal helper, ref resolver or IPC handler. The CDP expression-construction
module flagged by CodeQL in the old diff is not carried into this proposal.
Console messages are bounded, page-controlled informational data, not a
trusted command channel. Screenshots are scoped, size limited and cleaned up.

## Panel and copy

Use Browser as an ordinary Inspector tab, leaving the tab strip visible.
Use existing `Tabs`, `Button` and `IconButton` primitives and design tokens.
Keep the first layout plain until the design canvas pass. Retain reusable
address normalization, note chips, comments and viewport controls in later
focused changes, after their own tests.

- Sentence case and English only, including local status replies and errors.
  Link action: **Open in Zorvo's browser**.
- No added Cmd/Ctrl shortcuts or F5, native key interception or replay.
  Escape may cancel element picking. Every action has a button.
- Move page-opening and reveal behavior into focused hooks. Do not grow
  `App.tsx` with more inline handlers or start an ACP process for manual UI
  navigation.
- Keep address-bar parsing separate from chat. Chat messages follow the agent
  path; the UI does not intercept them with a browser-opening pattern match.
  Address normalization and link actions get their own tests. The treatment
  of address-bar text that is not a URL, including any search provider, remains
  an open decision for the panel PR.
- When browser UI ships, update README privacy for destinations and
  subresources loaded in the separate view and for the eventual address-bar
  decision. Keep the main Tauri webview network boundary unchanged. Update
  `CLAUDE.md`'s implemented tool inventory and architecture with those feature
  PRs.

## Validation and next work

Local checks: `pnpm lint`, the full `pnpm test` (344 files, 4,941 tests),
`pnpm build`, and 18 Node regression tests pass. Swift compiles with
warnings as errors for arm64 and x86_64, both targeting macOS 12.
No Rust runtime source changed, so no Rust check was rerun locally.
SIGTERM cancellation was exercised: the exact native test PID ended and
its loopback listener refused new connections afterward.

The Node step is separate from Vitest; `experiments/**` is excluded from
Vitest's default file discovery. Current-report source hashes and native
PNG hashes are checked in CI as well as the validator and fixture behavior.

The next work is completion and review of the canonical gate evidence,
particularly the OS-permission run and older-OS coverage, then the feature
spec. Engine/view, agent operations with session grants, and the ordinary
Inspector panel remain focused later PRs. The address-bar search provider
remains undecided.
