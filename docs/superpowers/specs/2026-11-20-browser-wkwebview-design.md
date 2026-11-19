# Browser: a native view beside the chat

Date: 2026-11-20. Status: design and spike evidence, waiting for review.
**Not a shipped browser.** The permissions gate and OS coverage remain open.

This replaces the CEF implementation in PR #256, following the
[review](https://github.com/zakyirsyaad/zorvo/pull/256#pullrequestreview-5984396049)
and the maintainer's
[engine decision](https://github.com/zakyirsyaad/zorvo/pull/256#issuecomment-7024203498).
The independent Clippy cleanup is [#257](https://github.com/zakyirsyaad/zorvo/pull/257);
OpenCode's transport task classification is [#258](https://github.com/zakyirsyaad/zorvo/pull/258).
Neither changes OpenCode itself.

## Engine decision

Use a native WKWebView child view, following `artifacts/view.rs`,
`useArtifactView` and `useBoxCovered`. The main Tauri webview draws controls
and leaves a measured box. WebKit draws the page and handles scrolling,
compositing and input directly. It is not a stream of images over IPC.

| Approach | Result |
| --- | --- |
| Bundled or optional CEF | Removed from this proposal. No CEF dependency, download, helper, entitlement or bundle change. |
| JPEG screencast into the UI | Rejected. Encoding, IPC and decoding add work to every visible frame. |
| WKWebView child view | Chosen, subject to the gates below. Uses the OS engine and native input. |
| Installed Chrome over a debugging pipe | Possible later project for trace, heap and Lighthouse. No worker or Chrome dependency in this version. |

No change to Zorvo's main CSP, signing, updater or install. No localhost
HTTP server is needed for browser use. The spike's temporary loopback server
only supplies its test page and synthetic cookies and ends with the test.

## Gates before engine implementation

Run the standalone harness in `experiments/browser-wk/`. It creates native
child views; it is not a substitute for testing the eventual Rust adapter.
Results below were observed on macOS 27.0.1 (26A434), arm64, with Xcode's
macOS 27.2 SDK, on 2026-11-20. Other OS versions have not been tested.

| Gate | Observed result | Still required |
| --- | --- | --- |
| Session cookie store | Pass. Tabs A1/A2 share a non-persistent store and a server-set HttpOnly cookie. Session B at the same origin receives none. Setting B's cookie does not change A. | Rust integration; storage, service worker and disposal checks. |
| Script the page cannot replace | Pass. A named `WKContentWorld` keeps the command dispatcher apart from a page's forged same-name global. An injection-shaped fill value remains literal data. No Tauri script or handler is installed. | Hostile frames, redirects and navigation-generation tests. DOM remains shared and page controlled. |
| Hidden tab remains usable | Pass for navigation, evaluation and filling while `isHidden`. | Integrated Inspector hide/show, menu occlusion, screenshots and process termination. Timers need not run at foreground frequency. |
| Camera and microphone | Pass. Explicit `WKUIDelegate` denials produce `NotAllowedError`; callbacks ran. | Same checks on every supported OS and nested frames. Do not rely on OS consent being absent. |
| Location | Pass on this Mac with the public geolocation delegate. That delegate is available from macOS 27, not all older targets. | A reviewed denial strategy and real tests on the minimum supported OS. The harness skips the request there and reports unverified. |
| Screen capture | **Public-delegate-only gate fails.** A trusted native click left the request pending without an automatic denial. A separate diagnostic SPI run denies it with `NotAllowedError` and a native callback. | Decide whether private WebKit selectors are acceptable and prove behavior on supported WebKit versions, including denial before any prompt. No production SPI decision is implied by this spike. |
| Native scrolling | Functional check passes: native input moved the page. | Trackpad/momentum, CPU/RAM and chat-stream comparisons below. A short RAF sample is not a performance certification. |

The public camera/microphone delegate is **not** a screen-capture deny-all.
WebKit documents the distinction in its
[display-capture delegate change](https://results.webkit.org/commit?id=279566%40main&repository_id=webkit).
The screen deny callback tested here lives in
[`WKUIDelegatePrivate.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKUIDelegatePrivate.h),
not the public SDK. Both known selector shapes are confined to the optional
`--screen-spi` diagnostic. A passing diagnostic on one Mac does not establish
compatibility or justify shipping it.

**Implementation remains gated.** Do not replace these checks with JavaScript
stubs: a page can recover native APIs from a fresh frame or realm. Do not
silently raise the application's minimum macOS version, depend on the user
rejecting a prompt, or substitute CEF if a gate is unresolved.

## Proposed boundary and lifetime

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
- Engine operations do not select the Inspector or change its active tab.
  A direct user Open/Show action reveals it. An agent screenshot or console
  read never steals the panel from another session.
- Views and WebKit callbacks stay on the main thread; other work and waiting
  must not block it. Every pending operation has a deadline and rejects on
  close, crash or navigation where relevant. No periodic message pump.

## First agent operations and permission

Only tabs, navigate, wait, snapshot, find, evaluate, screenshot, click, fill,
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
- Separate address-bar search from a chat's file reference. An address bar
  can normalize a host or search text. A file name such as `report.txt` or
  `README.md` in chat must not become a site. Test both paths explicitly.
- When browser UI ships, update README privacy: destinations and subresources
  load in the separate browser view; non-URL address-bar text is sent to
  Google search. Keep the main Tauri webview network boundary unchanged.
  Update `CLAUDE.md`'s implemented tool inventory and architecture then; the
  current seven-tool statements remain true in this design-only change.

## Performance acceptance before replacing a local build

Compare the integrated WK view with OpenCode's native browser on the same
local page, viewport, display and hardware. Also test a representative long
remote page, recording page content/network conditions. Run each scenario
several times in both orders:

1. Idle visible and hidden; CPU and resident memory for the app and its
   relevant WebContent/GPU processes. Record the measurement interval.
2. Continuous native trackpad scroll, including momentum, at least 20 seconds.
   Capture frame pacing and visibly missed input; distinguish synthetic
   wheel automation from physical trackpad input.
3. The same scroll while a fake local ACP fixture streams chat updates.
   No model requests or API credits are needed. Include resize and menus.
4. Tab/session switching, repeated open/close, and a page that loops or crashes.
   Check that the main UI remains responsive and resources are reclaimed.

Set the acceptance thresholds with the baseline measurement before claiming
parity. The small RAF samples in this spike only establish that native scroll
reaches the page; they provide no CPU/RAM comparison or user-latency result.

## Review and delivery order

1. Independent Clippy and transport PRs (#257, #258).
2. This design plus reproducible spikes. Resolve the screen/location strategy,
   OS matrix and performance criteria in review before engine work.
3. Engine and native view with the integrated lifetime/permission-denial tests.
4. Agent operations and session grant with denial, cancellation, stale-ref,
   cross-session and capture-cleanup tests.
5. Plain panel, address/link actions and comments, with design-system,
   keyboard, Inspector and privacy/documentation checks.

The previous inline findings on helper compilation, pump scheduling,
entitlements and worker shutdown disappear with the CEF engine removal.
Ordered tabs, live-session limits, grant checks, safe address handling and
non-revealing captures remain acceptance criteria for the WK implementation.
The old UI and engine are not being presented as reviewed fixes or shipped
alongside this design.
