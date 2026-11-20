# WKWebView browser spike report

Measured on 2026-11-20, macOS 27.0.1 (26A434), arm64. The
[canonical browser engine note](2026-11-20-browser-engine-design.md) is the
reference for the engine decision, gate criteria and open questions. This
report maps the standalone experiment to that note's spikes 1–10; it is
input to a later feature spec.

**The engine gates are not all certified.** With Screen Recording granted to
each test app, the ordinary Zorvo configuration removes the capture API in all
three tested realms and the supplementary public media delegate denies every
camera/microphone request. The React interaction test passes hidden, covered
and minimized. The required older-OS run is unavailable. wry/Rust integration,
real-page snapshots and the other gaps below remain work before feature
implementation.

The branch is rebased on main, including the merged #257, #258 and #259.
The former CEF implementation is retired. The current change ships no
browser engine, app entitlement or UI. The application's minimum macOS
version is unchanged; the canonical browser minimum is macOS 12 at runtime.

## Results by canonical spike

| Spike | What this probe shows | What remains |
| --- | --- | --- |
| **1. Store per session — partial** | Three independently configured Swift views use two non-persistent stores. Two views share `alpha`; the other session cannot read or overwrite it and retains `beta`. | The wry configuration path, `window.open`, scripts installed once, IPC after closing a sibling tab and absence of disk remnants. No store-by-identifier fallback is selected here. |
| **2. Script boundary — partial** | Typed fill data remains literal. A forged global plus replacements of `document.querySelector`, `Element.prototype.matches` and `JSON.stringify` leave the isolated snapshot's input and serialized proof intact. The page cannot reach the isolated native frame handler. | This is Swift, not Rust. wry's IPC and Rust checks, hostile navigation generations and production element references remain untested. The DOM is shared and untrusted. |
| **3. Hidden tab — observed pass for the standalone React case** | The short hidden, covered and minimized cases pass independently of the visible fallback. After 191.46 seconds hidden and 191.48 seconds minimized without page commands, click plus state/native snapshots complete in 7.13 and 166.35 ms. Four counter paths and their last five quiet seconds are recorded below. | Integration with the app, another Space, more page workloads and sustained cost. Hidden/minimized RAF stops; visible-window fallback measurements are below, with their limits. |
| **4. Usable snapshot — not exercised** | The local React fixture and native identities for same-origin and cross-origin frames are available. | The five real pages, accessible control names, open shadow roots, a full tree and references surviving until navigation. The probe's small state object is not that snapshot engine. |
| **5. Input — partial** | An isolated-world native value setter and input event update a real React controlled input; button clicks trigger a React re-render. | A native `select` and sites that reject script events. These events do not become trusted user input. |
| **6. Looping page — not exercised** | Normal temporary-app and loopback-fixture teardown is checked. | Five live tabs, `while (true) {}`, responsive Zorvo, ending that tab's WebContent process and memory reclamation. Normal exit does not prove this gate. |
| **7. No capture — launch-dependent layer 1, OS matrix incomplete** | With independent LaunchServices launches, a Zorvo-matching plist exposes no `mediaDevices`; with two strings, public callbacks deny all media requests. In a direct-child run of the same signed binary, media APIs return but the screen preference still removes `getDisplayMedia`, and public delegates deny all six media and three location requests. | Direct shell/development/release launches cannot assume layer 1. The feature spec needs that limit, older-OS runtime coverage and integration into wry. Compilation for macOS 12 is not runtime evidence. |
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
| None, independent app matching Zorvo | undefined | undefined | undefined | error 1; one public callback per realm |
| None, same signed binary as a direct Node child under ChatGPT/Codex responsibility | object | function | undefined | error 1; one public callback per realm |
| Camera and microphone | object | function | undefined | error 1; one public callback per realm |
| Camera only | object | function | undefined | error 1; one public callback per realm |
| Microphone only | object | function | undefined | error 1; one public callback per realm |

The current reports all validate their complete, mode-specific check sets:

- [Zorvo configuration](../../../experiments/browser-wk/results/2026-11-20-public.json):
  all 22 observations pass, including the Screen Recording precondition.
- [Both descriptions](../../../experiments/browser-wk/results/2026-11-20-usage-strings.json):
  all 21 observations pass with Screen Recording, camera and microphone OS
  authorization active. The display API remains absent. All six media
  requests return `NotAllowedError`, with one denying native callback each.
- [Camera only](../../../experiments/browser-wk/results/2026-11-20-camera-only.json)
  and [microphone only](../../../experiments/browser-wk/results/2026-11-20-microphone-only.json):
  13 passing API/isolation/location observations each and the unverified
  Screen Recording precondition. No media requests or public media-denial
  claim in these modes.

The two primary bundles report `screenRecordingGranted: true`. The ordinary
bundle has no camera/microphone authorization; the supplementary bundle has
both, approved for this test. No captured stream was obtained. The
single-description diagnostics were collected without Screen Recording
authorization and keep that precondition unverified.

Earlier supplementary attempts timed out before the media delegate while
OS authorization was undetermined. TCC logs also reported that LaunchServices
could not resolve the test bundle identifier. The runner now registers each
unique bundle identity, and `--prepare` keeps a signed binary in Application
Support for reuse. Its explicit permission-setup step loads no page or
capture stream. After the user approved the OS grants for that exact binary,
the normal collection reached all six public media-denial callbacks. This
separates OS setup from a page's denied request. A timeout still cannot pass
the validator.

The temporary probes' Screen Recording, camera and microphone grants were
revoked after collection. System Settings no longer lists the probe under
Screen & System Audio Recording. The recorded results describe the granted
test condition, not a permission left enabled on the developer's Mac.

The [recorded direct-child run](../../../experiments/browser-wk/results/2026-11-20-direct.json)
names ChatGPT (`com.openai.codex`) as the responsible app. The launcher is the
Node harness; the native parent PID is recorded without a resolved GUI app
identity. Both camera and microphone authorization are `authorized` in this
launch, and Screen Recording is granted through the parent context. It uses
exactly the same signed binary as the new
[LaunchServices comparison](../../../experiments/browser-wk/results/2026-11-20-launchservices.json),
at source commit `16a6c47b`, with no camera, microphone or location
description. All three direct-run realms expose `mediaDevices` and `getUserMedia`, while
`getDisplayMedia` remains undefined. Each camera/microphone request returns
`NotAllowedError` through one public callback, and location returns error 1
through one public callback. WebAssembly and dynamic JavaScript still work.

This is evidence against an unconditional layer-1 claim, including direct
terminal starts of a development or release executable. The direct recording
explicitly marks `usageStringBoundaryHolds: false`. Its launch-specific gate
requires the inherited media API to be present before counting the public
denials, so a no-grant parent with absent APIs cannot pass this third run.
The narrower direct assessment passes. The paired independent launch has
undetermined camera/microphone authorization and no `mediaDevices`; its own
Screen Recording grant is active and the tightened assessment passes. Other
parent apps and older OS versions remain untested;
the maintainer's [canonical-note update in #270](https://github.com/zakyirsyaad/zorvo/pull/270)
records this limit rather than assuming declarations alone cover every launch.
That separate update also adds this as the third launch required by spike 7.

Source and bundle hashes, launch mode,
OS authorizations, assessment scope and deployment target accompany the
current reports. Intel compilation passes with a macOS 12 target; Intel
runtime and any runtime below 27 remain unverified.

The earlier [public, screen-SPI and restricted reports](../../../experiments/browser-wk/results/historical/)
retain their original hashes as historical evidence. They are superseded
configurations, not validation of the selected policy. Each report names the
commit that supplied its probe and hashes. CI validates its schema and
assessment, leaving source comparison to that named commit rather than
requiring new recordings after every later source edit. New collections also
name the collector commit independently of the prepared binary's source.
LaunchServices resolution now records only a boolean and the snapshot/app
names; the earlier reports' absolute home paths have been removed.

Every non-preparation run unregisters its temporary application in `finally`,
including failures and reused snapshots. `--clean` validates a prepared
snapshot, refuses a running process or linked paths, unregisters it and removes
only that snapshot. Registration cleanup was also applied to the older local
probe entries. These commands do not change installed applications or revoke
OS grants; permission-test grants are revoked before cleanup.

## Hidden and covered React measurements

The original granted-permission recording, at `f09ca7a3`, has one sequential
run; each condition lasts about five seconds. The page
renders a 100 ms timeout counter, an animation-frame counter and completed
fetches from a loop with a 200 ms delay. Counts measure progress over the
actual recorded interval, not a promised background frequency.

| View/window state | Seconds | Timeouts | RAF | Fetch completions | Click to updated native snapshot | Host + main WebContent CPU, one core | Resident MiB at end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Visible | 5.11 | 50 | 307 | 25 | 5.1 ms | 0.40% | 155.6 |
| View hidden | 5.33 | 5 | 0 | 19 | 5.6 ms | 0.11% | 138.7 |
| Native window fully covering it | 5.25 | 8 | 3 | 19 | 4.4 ms | 0.11% | 143.2 |
| Window minimized | 5.32 | 5 | 0 | 19 | 11.3 ms | 0.09% | 139.1 |
| View at zero alpha | 5.03 | 48 | 303 | 25 | 4.7 ms | 0.38% | 141.3 |
| View offscreen inside the window | 5.33 | 51 | 320 | 26 | 5.5 ms | 0.45% | 150.0 |
| Opaque sibling view covering it | 5.33 | 51 | 318 | 27 | 4.1 ms | 0.39% | 125.4 |

The minimized flag is true in that row, and the fully covered window has no
visible occlusion state. Native before/after crops show the counter changing
[1 to 2 while hidden](../../../experiments/browser-wk/results/2026-11-20-background/hidden-after.png),
[2 to 3 while covered](../../../experiments/browser-wk/results/2026-11-20-background/covered-after.png)
and [3 to 4 while minimized](../../../experiments/browser-wk/results/2026-11-20-background/minimized-after.png).
Their corresponding before images are in the same folder, and CI verifies
all six image hashes against the native report.

**Background behavior:** the tested React click and snapshot work directly.
The chained 100 ms timeout advances about once a second when hidden or
minimized. The fetch loop's 200 ms timer, scheduled after an awaited response,
advances much more often: 19 completed fetches in each approximately
five-second hidden/minimized interval in this recording. The later recordings
below do not all repeat that ratio. RAF stops in those two states. A wait based on self-rearming timer polling, awaited network
responses or animation frames therefore has three different progress
patterns. Where the timer is scheduled may explain the difference, but this
report does not establish WebKit's cause. The updated fixture also measures a
plain 100 ms `setInterval` deliberately and records it separately below.
Zero alpha, offscreen placement and a same-window cover retained
roughly 60 RAF callbacks/s in this run, providing candidates when such
progress is required. They were measured with the host window visible;
they do not demonstrate foreground-rate scheduling while that window is
minimized or on another Space. The feature spec must account for that limit.

### Plain interval and longer hidden runs

The [schema 4 recording](../../../experiments/browser-wk/results/2026-11-20-long-hidden.json)
uses source commit `16a6c47b`, adds a plain 100 ms interval and retains the app's
own Screen Recording grant through collection. All 24 current observations pass.
The short conditions record these changes after each click:

| Condition | Seconds | Chained 100 ms timeout | Plain 100 ms interval | RAF | Fetch completions |
| --- | --- | --- | --- | --- | --- |
| visible | 5.25 | 51 | 51 | 315 | 25 |
| hidden | 5.19 | 3 | 3 | 0 | 5 |
| covered | 5.25 | 4 | 4 | 5 | 6 |
| minimized | 5.21 | 3 | 3 | 0 | 6 |

These counts differ from the `f09ca7a3` recording above. For the hidden,
covered and minimized conditions, in that order, the four recordings give
these chained-timeout ticks and completed fetches in about five seconds:

| Recording | Timeout ticks | Fetch completions |
| --- | --- | --- |
| `f09ca7a3`, independent launch | 5, 8, 5 | 19, 19, 19 |
| `16a6c47b`, independent launch | 5, 8, 5 | 19, 19, 18 |
| `16a6c47b`, direct launch | 3, 5, 6 | 7, 7, 8 |
| `16a6c47b`, long-hidden run | 3, 4, 3 | 5, 6, 6 |

The last three rows are one signed binary. The fetch loop ran well ahead of
the timers in two recordings and close to them in the other two, and what
differed between those runs was not measured. A wait must not assume either
rate. RAF stopped in the hidden and minimized conditions in all four.

Two additional conditions leave the page alone for at least three minutes,
without native page commands. Bounded page-side history supplies the trailing
counter window before the first command. The actual span is recorded, rather
than clamped to five seconds; schema 4 requires 5000–6500 ms and rejects a stale
baseline after suspension. The pre-idle image precedes the quiet period, then
the React click and command/native snapshots follow it.

| Condition | Actual quiet duration | Counter span | Timeout / interval / RAF / fetch | Command snapshot | Updated native image |
| --- | --- | --- | --- | --- | --- |
| hidden-after-idle | 191.46 s | 5587 ms | 6 / 6 / 0 / 5 | 2.58 ms | 7.13 ms |
| minimized-after-idle | 191.48 s | 5278 ms | 6 / 6 / 0 / 13 | 41.81 ms | 166.35 ms |

Both conditions record actual documentHidden true; minimized also records
windowMiniaturized true. Hidden, fallback and long-hidden gates are separate.
The [four crops](../../../experiments/browser-wk/results/2026-11-20-long-hidden/)
show React state 7 to 8 and 8 to 9. CPU/resource samples cover only the usual
five seconds after each click, not the three-minute quiet period. Another
Space, sustained costs and other page workloads remain untested.

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

For this review update, `pnpm lint`, the app's permission-boundary Vitest
file and 32 Node regression tests pass. The earlier full `pnpm test`
(344 files, 4,948 tests) and `pnpm build` passed at `f09ca7a3`; CI runs the
full app checks again on the updated head. Swift compiles with warnings as
errors for arm64 and x86_64, both targeting macOS 12.
No Rust runtime source changed, so no Rust check was rerun locally.
SIGTERM cancellation was exercised: the exact native test PID ended and
its loopback listener refused new connections afterward.

The Node step is separate from Vitest; `experiments/**` is excluded from
Vitest's default file discovery. Reports name their source commit and retain
source hashes as recorded evidence. CI checks structure, assessment and PNG
attachments, without comparing source hashes with the checkout. A future
probe or summary-script edit can merge without collecting old reports again.
The app suite guards only the app plist; the experiment suite guards its own.

The next work is completion and review of the canonical gate evidence,
particularly older-OS coverage and the remaining wry paths, then the feature
spec. Engine/view, agent operations with session grants, and the ordinary
Inspector panel remain focused later PRs. The address-bar search provider
remains undecided.


## Fourth-review measurements

The current probe uses schema 4. A prepared identity remains registered through
permission setup, collection and grant revocation; `--clean` owns its removal.
Temporary runs still unregister in `finally`. The runner checks the requested
launch and long-hidden flags against the result and assesses it with both the
snapshot and current validators. Old snapshots cannot silently satisfy a new run.

The replacement direct and independent recordings use the same signed binary at
`16a6c47b`. The independent run has its own Screen Recording grant and passes all
23 current observations. The direct run identifies ChatGPT/Codex responsibility,
records authorized camera and microphone status, and passes the public-denial
checks in all three realms. If those inherited APIs are absent, schema 4 reports
the direct condition as unverified. Under a partial grant it requests only the
authorized device and marks the other not attempted, avoiding an undeclared-device
TCC request. The Screen Recording evidence names its responsible application.

The replacement long-hidden recording also has the app's own Screen Recording
grant and passes all 24 current observations. Its actual quiet periods are
191.46 seconds hidden and 191.48 seconds minimized, with no native page commands.
Click-to-command/native-image latencies are 2.58/7.13 ms and 41.81/166.35 ms.
The trailing counter spans are **5587 ms** and **5278 ms**, not exactly five seconds:
chained timeout/plain interval/RAF/fetch counts are 6/6/0/5 and 6/6/0/13.
`windowMs` and `oldestSampleAgeMs` now report the actual baseline age. Schema 4
accepts a 5000–6500 ms range and rejects stale/suspended history. These numbers
replace the earlier clamped-span recording and table.
The earlier short baseline remains historical evidence for its named commit.

CI names all seven required recordings, their modes and schemas, in addition to
scanning shared structure and validating attachments. It still does not pin
historical hashes to the checkout. The current probe adds regression tests for
old launch modes, stale quiet history and unexercised direct authorization.
