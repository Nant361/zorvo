# In-app browser: which engine

Date: 2026-11-20. Status: direction approved on 2026-11-20, after an
independent review whose findings are folded in below. The spikes in section 6
have not been run, and no feature code follows until the gate spikes pass.

## Why this note exists

PR 256 adds a browser beside the chat, built on a bundled Chromium (CEF). Its
review asked for the engine to be settled before more code is written, because
the engine decides the download size, the entitlements of the main process and
the build chain, and none of those can be changed cheaply later.

This note compares three engines, picks one and lists what has to be proven
first. It is not the feature spec. Screens, copy and artboards come after the
engine is settled, in a spec of their own.

## 1. What the browser is for

Three jobs, most frequent first:

1. **The user looks at a page beside the chat.** A link from a reply, their
   dev server, a docs page. They can add the page, or one element of it, to
   their next message.
2. **The agent checks web work it just did.** It opens `localhost`, reads the
   page, clicks, fills a form, takes a screenshot and reads the console.
3. **Deep diagnosis.** Response bodies, performance traces, heap snapshots,
   Lighthouse.

This note assumes jobs 1 and 2 are the product and job 3 is rare. That is an
assumption the maintainer accepted with the approval, not a measured fact; see
section 8. Computer use is planned separately and will reach the
user's real browser, so the in-app browser does not have to be that.

## 2. What the project already holds to

- **A small download.** The update package of v0.13.1 is 17.7 MB.
- **A main process with no entitlements.** It holds the Private mode Keychain
  items and Zorvo's Screen Recording and Accessibility grants. `spawn/` exists
  so that child processes do not inherit those.
- **Pinned downloads.** Every runtime Zorvo installs has a SHA-256 in
  `runtimes.json`.
- **A grant before an agent reaches out.** `delegate` and `start_session` wait
  for a card the user answers.
- **A build that one person can run.** The Release workflow builds, the
  maintainer signs on their Mac. A cold Rust build takes about nine minutes.
- **One native child view already.** Artifact pages run in a wry child webview
  (`artifacts/view.rs`), placed by `useArtifactView` and hidden by
  `useBoxCovered` when something covers it.

## 3. The three engines

**A. Bundled CEF.** What PR 256 does: Chromium Embedded Framework inside the
app bundle, five helper apps, DevTools commands sent to it through a Node
worker.

**B. WKWebView.** The system's WebKit view, made with wry as a child of the
main window, the way artifact pages are. Agent operations run as script in the
page and through WebKit's own API.

**C. The user's installed Chrome, over a CDP pipe.** Zorvo starts Chrome,
Chromium or Brave with a temporary profile and `--remote-debugging-pipe`, and
talks DevTools protocol to it. No browser is bundled.

| | A. Bundled CEF | B. WKWebView | C. Installed Chrome |
|---|---|---|---|
| Added to every download | about 277 MB (134.9 MB arm64 + 141.7 MB x64, as published for CEF 156.0.31) | nothing | nothing |
| Main-process entitlements | JIT, unsigned executable memory, library validation off (as the PR ships it) | none | none |
| Build chain | CEF fetched at build time, its hash read from the same CDN; a C++ wrapper build; a second cargo build for the helpers | unchanged | unchanged |
| Extra processes | five helper apps, a Node worker per session, a 30 Hz message pump | WebKit's own content process per tab | Chrome's processes, a worker per session |
| Page beside the chat | native view | native view | no: Chrome's own window, or screenshots of a headless one |
| Engine | Chromium | WebKit, what Safari runs | Chromium |
| Needs something installed | no | no | Chrome, Chromium or Brave |
| Read, click, fill, screenshot | DevTools protocol | script in the page, `takeSnapshot` | DevTools protocol |
| Console | yes | yes, by a recorder in the page's own script world, which the page can alter | yes |
| Network | requests, headers, bodies | `fetch` and XHR the page makes, and resource timing; no headers or bodies of other loads | requests, headers, bodies |
| Traces, heap, Lighthouse | yes | no | yes |
| Code from PR 256 that carries over | all of it | the panel UI, address parsing, note chips, link menu item | the worker and its 45 operations |

Two facts behind the table, checked on 2026-11-20:

- The CEF sizes come from the build index the `download-cef` crate reads; it
  always takes the `minimal` distribution, and a universal bundle needs both.
- wry 0.57 (the version Tauri pins here) has most of what option B needs:
  `with_webview_configuration` (macOS), a navigation handler, a new-window
  handler, a download handler and a page-load handler, and
  `WebViewExtMacOS::webview()` hands out the native view. The `objc2-web-kit`
  crate it builds on has `takeSnapshotWithConfiguration` and
  `callAsyncJavaScript…inContentWorld`; Zorvo would have to depend on that
  crate directly, which it does not today.
- wry does not cover everything, and three gaps shape the design:
  - A configuration passed in brings its script controller with it
    (`wkwebview/mod.rs:301`), and every webview built on it adds wry's scripts
    and its `ipc` handler again. So tabs cannot share one configuration; each
    tab needs its own, with only the data store shared.
  - The permission handler covers camera and microphone only, and wry
    **grants** when no handler is set (`wry_web_view_ui_delegate.rs:164`).
    Location and screen capture never reach it.
  - wry implements no delegate for `alert`, `confirm` or `prompt`.

## 4. Decision

**Build the browser on WKWebView (B), provided the gate spikes in section 6
pass.** Reject bundled CEF (A). Keep the installed-Chrome route (C) as a
later, separate feature for job 3, if job 3 turns out to be wanted.

B is certain for job 1. For job 2 it depends on spike 3: if a hidden tab
cannot be kept working, the agent's checks move to C and B stays the view the
user looks at.

Reasons:

- B does jobs 1 and 2 with no cost to the download, the entitlements or the
  build. A does all three jobs and charges every user about 277 MB for the
  third, on every update.
- The hard parts of B are already solved once in this repository: a child
  webview Tauri never sees, its placement over a DOM box, hiding it under
  menus, ending a page that loops, a page script with a pinned hash, and
  checks on every message a page sends.
- B removes whole findings of the PR 256 review instead of fixing them: the
  entitlements on the main binary, the worker killed without cleanup, the
  message pump that never stops, the third compile of a universal build.
- C gives real Chromium and the full protocol for nothing, but it cannot put
  the page beside the chat, which is job 1. It fits job 3 well, and PR 256's
  worker was written against plain DevTools protocol, so most of it would
  serve C unchanged.

### What B gives up

- **It is WebKit.** A page can look or behave differently than in Chrome.
  The tool's answers should name the engine, so an agent does not report
  "works in the browser" for something it only saw in WebKit.
- **No response headers or bodies** except for requests the page's own script
  makes.
- **Clicks and typing are script events.** A site that checks `isTrusted`
  will ignore them. Real pointer events would need native input, as computer
  use will have.
- **No file upload by the agent** in the first version. That removes the most
  direct way to send a workspace file to a site, not every way: `navigate`
  with a query string, `fill` and a submit, or `evaluate` with `fetch` can
  carry the same text. The grant in section 5 is the control, not the missing
  operation.
- **No device emulation** beyond the size of the view.
- **Page dialogs do not show.** With no delegate, a page's `confirm()` most
  likely returns false at once and `alert()` shows nothing, for the user as
  well as the agent. A site that asks "Are you sure?" this way cannot be
  answered (spike 9).
- **Some sites refuse an embedded view.** WKWebView's user agent carries no
  Safari version, and Google sign-in, among others, blocks or degrades it.
- **Plain `http` to a public host is likely blocked.** `Info.plist` has no App
  Transport Security settings. `localhost` and IP addresses are exempt, so a
  dev server loads; `http://example.com` and names like `app.test` probably do
  not (spike 8).
- **A hidden tab slows down.** WebKit throttles timers and pauses
  `requestAnimationFrame` in a view that is hidden or covered, so a page the
  agent drives in the background may not re-render (spike 3).
- **Some content is out of reach.** A cross-origin frame is read only by a
  script injected into that frame, and a closed shadow root cannot be read by
  script at all.

## 5. Shape of B

Enough to judge the decision. The feature spec will replace this section.

- **Backend, `src-tauri/src/browser/`.** `view.rs` makes one wry child webview
  per tab and shows one at a time; `session.rs` holds a session's tabs, its
  data store and its limits; `ops.rs` validates and runs an agent's
  operations; `commands.rs` holds the Tauri commands. There is no Node worker:
  operations are checked in Rust, as `agent_tools/tools.rs` checks the other
  tools.
- **Isolation.** One non-persistent `WKWebsiteDataStore` per session, shared
  by that session's tabs and dropped with the session. wry's `with_incognito`
  makes a store per webview, so each tab gets a fresh configuration of its own
  that points at the session's store (spike 1).
- **Two script worlds.** A content world shares the page's DOM but none of its
  script globals, so the work splits in two:
  - *Zorvo's world* builds the snapshot with element references, performs
    click and fill, and picks an element for a comment. The page cannot read
    or replace this code. It is called with `callAsyncJavaScript`, which
    returns the answer, so agent operations need no message handler. Picking
    does need one, and wry registers `ipc` in the page's world only, so Zorvo
    would add its own handler for its world (spike 2). The picking code starts
    from `artifacts/page_script.js`.
  - *The page's world* is where `evaluate` runs, because the agent wants the
    app's own globals, and where the console recorder has to live. A page can
    see and alter both. That is accepted and stated in the tool's answers:
    console lines and `evaluate` results are what the page chose to show.
- **What a page may do.** Load `https`, and `http` where the system allows it
  (see section 4). Camera and microphone are refused by a permission handler
  that always denies, never left to wry's default. Location and screen capture
  have no handler in wry, so spike 7 has to show they are refused. Downloads
  are refused. A new window opens as a tab up to the session's limit, built
  like any other tab, otherwise it is refused.
- **Ending a page.** `_killWebContentProcess`, as `artifacts/view.rs::end`
  does, because dropping the view does not stop a page that loops.
- **Frontend.** A Browser tab inside the inspector's normal tab strip. The
  placement code is shared with artifacts, and only one native view is on
  screen at a time across both.
- **Agent tools.** `browser` and `browser_guide` on the existing Zorvo server.
  First version: `tabs.list`, `tabs.open`, `tabs.focus`, `tabs.close`,
  `navigate`, `back`, `forward`, `reload`, `wait`, `snapshot`, `find`,
  `evaluate`, `screenshot`, `click`, `fill`, `select`, `check`, `scroll`,
  `console`. Left out: network, files, drag, dialogs, traces, CPU, heap,
  Lighthouse.
- **Grant.** A session's first `browser` call waits on a Zorvo card with
  **Allow for this session** and **Deny**, kept in memory only, like the
  delegation grant. Taking it back goes in the same ⋯ menu.

## 6. Spikes, before any feature code

Each one is a throwaway probe, as in the artifacts spec. The results go into
the feature spec.

1. **A store per session.** Each tab is built on its own configuration that
   points at one shared non-persistent store. Two tabs of a session share a
   cookie; a tab of another session does not see it; a tab opened by
   `window.open` behaves like the others, with wry's scripts added once and
   its `ipc` still working after another tab closes; nothing is left on disk
   after the session closes. The fallback, a store by identifier that Zorvo
   removes on close, needs macOS 14.
2. **A script the page cannot touch.** A function defined in Zorvo's content
   world is not visible from the page; a page that overwrites
   `Element.prototype`, `document.querySelector` or `JSON` does not change
   what the snapshot returns; and a message sent from Zorvo's world reaches
   Rust through a handler the page's world cannot call.
3. **A tab that keeps working while hidden.** With the view hidden or covered,
   a `click` changes a React page's state, and the next snapshot and the next
   `takeSnapshot` both show the new state within a second. If hiding stops the
   page, find a way to keep it live (off-screen, or behind the main view) and
   measure what that costs.
4. **A usable snapshot.** On five real pages (a React app on `localhost`,
   GitHub, a docs site, a long form, a page with an open shadow root and a
   cross-origin frame) the tree names the controls a person would name,
   content inside the frame is reached through a script in that frame, and a
   reference still finds its element until the page navigates.
5. **Input that takes.** `fill` and `click` drive a React controlled form and
   a native `<select>`. Write down where script events are ignored.
6. **A page that loops.** With five tabs open, one running `while (true) {}`
   leaves Zorvo responsive, and closing that tab ends its process. Record the
   memory five tabs use.
7. **A page cannot capture.** With Screen Recording granted to Zorvo, a page
   that calls `getDisplayMedia`, `getUserMedia` and
   `navigator.geolocation.getCurrentPosition` gets a refusal for each, with no
   system prompt in Zorvo's name.
8. **What loads.** `https://example.com`, `http://localhost:3000`,
   `http://127.0.0.1:3000`, `http://app.test` and `http://example.com`: record
   which load with today's `Info.plist`.
9. **Dialogs and the file picker.** Record what `alert`, `confirm`, `prompt`
   and a click on `<input type="file">` do, for a click by the user and for a
   click by the agent.
10. **Two kinds of native view.** An artifact page and a browser tab do not
    fight over placement when the user moves between the two inspector tabs,
    and typing focus returns to the composer when the page gives it up.

Spikes 1, 2, 3 and 7 are the gate. If one of them fails with no fallback, this
note is reopened before anything else is built. Spike 3 is the one most likely
to decide whether B can do job 2 at all.

## 7. What happens to PR 256

- **Can merge on their own now:** the OpenCode transport fix in
  `background_processes.rs` with its test, and the `url_check.rs` cleanup.
- **Carries over to B:** `browser-address.ts`, the note chips and
  `browser-note.ts`, the comment overlay, the toolbar and viewport controls
  (once they use the `ui/` primitives), the link menu item, the operation
  names and schemas in `catalog.mjs` as the reference for `ops.rs`.
- **Kept for C, if C is built:** the worker (`main.mjs`, `page.mjs`,
  `files.mjs`, `analysis.mjs`).
- **Not used:** `browser_native.rs`, `cef_helper.rs`, `prepare-browser.mjs`,
  `browser-targets.mjs`, `browser.entitlements.plist` and the bundle changes
  in `tauri.conf.json`.

## 8. Decisions taken with the approval, and what stays open

Taken on 2026-11-20. The maintainer asked for the note to be reviewed and then
approved, so these three follow the note's own recommendation and can be
reversed by saying so:

1. **Job 3 is not in the first release.** No traces, heap snapshots or
   Lighthouse. If they turn out to be a reason the browser exists, C is built
   beside B.
2. **WebKit is accepted for the agent's checks.** The tool's answers name the
   engine.
3. **"open google" is not answered without the agent.** PR 256 did that with a
   pattern match on the message, which also caught "open main.py". The link
   menu and the address bar are the user's ways in, and the agent has the
   tool.

Still open:

4. **Who builds it, and when.** The contributor of PR 256, or in-house, and
   before or after computer use.
5. **Minimum macOS.** `tauri.conf.json` sets none today. Content worlds need
   macOS 11. If spike 1 has to fall back to a store by identifier, the minimum
   becomes 14, and that is a decision to take before the feature spec, not in
   it.
6. **Plain `http` to public hosts.** Recommended for the first version: do not
   change `Info.plist`; load `https` and local addresses, and say so plainly
   when a page is refused. Allowing it means
   `NSAllowsArbitraryLoadsInWebContent`, which applies to every web view in
   the app.
