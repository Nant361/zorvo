# Artifacts: pages an agent makes, shown in Zorvo

Date: 2026-11-16. Status: design, waiting for review.

## Goal

An agent can make a web page (a report, a diagram, a dashboard, a mockup) and
Zorvo shows it beside the chat. The user reads it, asks the agent to change it,
looks at older versions and saves it as a file. The model is Claude Code's
artifacts, without the hosting: an artifact stays on this Mac.

This spec is the foundation plus free-form HTML pages. A second spec will add
typed artifacts (a design canvas) on the same foundation.

## Decisions made with the user

- **Local, with export.** No server, no account, no URL. Export writes one
  `.html` file where the user chooses.
- **Scripts from an allow list of CDNs**, the same list Claude uses, so a page
  can use Tailwind, Chart.js, D3 or Mermaid. The main webview still makes no
  network request; only the artifact frame loads from those hosts.
- **Shown in an Artifacts tab of the inspector**, with a card in the chat and
  Expand / Shrink.
- **An artifact belongs to its session.** A gallery lists every session's
  artifacts. Deleting a session deletes its artifacts.
- **The agent hands over a file path**, not the page's text.

## Out of scope

Typed artifacts and the design canvas, publishing to a URL, comments on an
artifact, a database or storage for pages, supporting files next to the page,
Markdown artifacts, artifacts in a popout window, artifacts for sessions that
get no Zorvo tools (compare runs, delegated sessions, sessions an agent
opened), links from a page to the outside, thumbnails in the gallery.

## 1. Sandbox

### What it protects

The page is written by an agent, which can be wrong or steered by text in the
repository. The sandbox guarantees the page cannot reach Zorvo: no Tauri
command, no state, no other artifact or session, no file on disk.

It does not try to stop an agent from leaking data. The same agent has a shell.
Two channels stay open and are accepted, as Claude accepts them: a page can put
data in the URL of a script request to an allowed CDN, and an exported file
runs with no sandbox at all.

### How a page loads

1. **A custom protocol.** The backend registers the scheme `zorvo-artifact`.
   A URL is `zorvo-artifact://localhost/<sessionId>/<artifactId>/<version>`.
   The handler checks the shape of all three parts, answers only GET, and reads
   the stored copy from the data dir. Anything else is 404. The webview never
   sends a path.
2. **A sandboxed frame.** The tab loads that URL in
   `<iframe sandbox="allow-scripts">`. Without `allow-same-origin` the page has
   an opaque origin: no cookies, no `localStorage`, and not an origin Tauri's
   IPC accepts. The frame has a `title` for assistive technology.
3. **The page's own CSP**, sent by the handler as a response header, with
   `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` and
   `Content-Type: text/html; charset=utf-8`:

   ```
   default-src 'none';
   script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com;
   style-src 'unsafe-inline' https://fonts.googleapis.com;
   font-src https://fonts.gstatic.com data:;
   img-src data: blob:;
   media-src data: blob:;
   connect-src 'none'; frame-src 'none'; object-src 'none';
   form-action 'none'; base-uri 'none'
   ```

   No `'unsafe-eval'` unless the spike shows a library on the list needs it;
   that is then a decision for the user, not the implementer.
4. **One change to Zorvo's CSP**: add `frame-src zorvo-artifact:`. `script-src
   'self'` and `connect-src` of the main webview do not change.
5. **Navigation.** The window gets a navigation handler that allows only the
   app's own origin and `zorvo-artifact://localhost/`. A page that sets
   `location` to a website, or a link to one, goes nowhere. Links inside the
   page (`#section`) work.

**Room for comments later.** Comments on a page are a separate spec, after this
one. They will need a small script of Zorvo's own added to each served page,
which reports the selected text and the clicked element with `postMessage`.
So the handler builds the body it serves in one function (today it returns the
stored bytes unchanged), `script-src` in the page's CSP is the only directive
that would change, and export always writes the stored bytes, never the served
body.

A page cannot open a window, download a file, show an `alert`, or keep anything
between two openings.

### Spike: the gate before any other code

Reading the sources of Tauri 2.12.5 and wry 0.57 says the IPC scripts are
injected in the main frame only, and that the navigation handler is called
without a main-frame filter. That is reading, not proof. Step 0 of the plan is
a throwaway build that shows, in the real WKWebView:

1. **IPC is out of reach** from the frame: `window.__TAURI_INTERNALS__` is
   undefined, `fetch('ipc://localhost/…')` is refused, and a message posted
   straight to `window.webkit.messageHandlers.ipc` runs no command.
2. **Navigation out is refused**: `location.href = 'https://example.com'`,
   a clicked link and a `<meta http-equiv="refresh">` load nothing in the frame.
3. **Common libraries work** under the CSP above: Tailwind's CDN build,
   Chart.js, D3, Mermaid, and a Google Font.

4. **A page that never yields** (`while(true){}`): whether Zorvo's own
   interface stays usable, since WKWebView may run the frame in the page's
   process.

If 1 fails, or 4 freezes the app, this design stops and goes back to the user
with an alternative (a separate webview for artifacts). If 2 fails, it is
recorded here as a known hole. The result of 3 fixes the CSP text. The check of 1 stays afterwards as a
permanent real-app test.

### Spike results (2026-11-16)

Run on a debug build with the production CSP (Tauri 2.12.5, wry 0.57, macOS
WKWebView), a throwaway branch `spike/artifacts-sandbox`. Each page reported
through `postMessage`; the log is the evidence.

| # | Question | Result | Evidence |
| --- | --- | --- | --- |
| 1 | IPC out of reach | **Pass** | `__TAURI_INTERNALS__`, `__TAURI__` and `window.ipc` are undefined in the frame. `fetch('ipc://…')` fails under the page CSP, and without it Tauri answers 500 "Origin header is not a valid URL". `window.webkit.messageHandlers.ipc` **is** reachable from the frame, and a hand-built invoke posted to it was refused only because it did not carry the invoke key; the command never ran. |
| 2 | Navigation out refused | **Pass** | `location.href`, a clicked link and a meta refresh to `https://example.com` all loaded nothing; the page was still there 3.5 s later. Zorvo's own `frame-src zorvo-artifact:` refused them (a `frame-src` violation each time), before the Rust handler was asked. The handler is called for the frame's own loads, so it stays as a second layer. |
| 3 | Libraries without `unsafe-eval` | **Pass** | Tailwind's CDN build applied its classes; Chart.js, D3 and Mermaid drew; lodash and jQuery loaded; a Google Font loaded. No CSP violation but the expected one for `fetch` (`connect-src`). `localStorage` throws `SecurityError`, as designed. The CSP text stands as written. |
| 4 | A page that never yields | **Fail** | The frame runs in the main page's web content process. From the moment the page entered `while(true){}` the main interface stopped completely (its 500 ms timer never fired again in 68 s) until the app was killed. |

What follows from them:

- The invoke key, kept in the main frame, is the only thing between a page and
  Tauri's message handler. Nothing may ever inject Tauri's scripts or the key
  into a frame (`initialization_script_for_all_frames` is forbidden), and the
  real-app test of 1 is permanent.
- Navigation URLs seen on a normal start: `tauri://localhost`, `about:blank`,
  `zorvo-artifact://localhost/…`.
- Result 4 stops this design as written: a sandboxed frame cannot protect
  Zorvo's interface from a page that loops. The frame must move out of the main
  webview's process. **Sections 1 and 4 are on hold until the user chooses how.**

## 2. Tools

Two tools join the five in `agent_tools/tools.rs`. Both are answered by the
webview through the existing `agent-tool-call` path, need no grant and show no
permission card. A session gets them exactly when it gets the other tools
(`sessionGetsAgentTools`, the **Agent tools** setting). Pi uses them as
`zorvo tools show_artifact …`, and `COMMAND_PATH_CONTEXT` names both.

### `show_artifact`

| Argument | Rule |
| --- | --- |
| `path` | Required. An `.html` or `.htm` file the agent has written. At most 4096 characters. |
| `title` | Required the first time a path is shown, optional later (it renames). At most 60 characters, cleaned with `escapeVisible`. |

The same path is the same artifact: a second call for it makes a new version, a
different path a new artifact. The answer is JSON with the title, the version
number and `shown: true`. Its description holds the hard rules (one
self-contained HTML file, the CDN list with exact versions, no `fetch`, images
as data URIs) and tells the agent to call `artifact_guide` before its first
page.

### `artifact_guide`

No arguments. Returns the design guide: colours as tokens with light and dark
values under `prefers-color-scheme`, type, a layout that holds at the
inspector's narrow width and when expanded, no reliance on `localStorage`, how
to draw charts and diagrams that read well. The text ships with Zorvo
(`src/lib/artifact-guide.md`, imported as text) and is written for Zorvo, not
copied. It is tested with real agents (Claude Code, Codex, Antigravity) and
revised from what they produce; that revision is part of the work.

### Checks on the path, in Rust

The webview answers `show_artifact` by calling
`artifact_show(sessionId, cwd, path, title)`. The backend:

1. checks `cwd` with `files::ensure_known_workspace`, and the session id's
   shape (`[A-Za-z0-9_-]`, 1 to 80 characters);
2. resolves `path` against `cwd` and canonicalises it; it must lie inside the
   canonical session folder or a temporary folder (the canonical
   `std::env::temp_dir()` or `/private/tmp`);
3. reads only a regular file, judged from its metadata, with an `.html` or
   `.htm` name, at most 16 MiB (bounded read), valid UTF-8.

A refusal is a fixed sentence for the agent and never repeats the path.

## 3. Storage

The backend owns artifacts completely; nothing about them is in `state.json`,
so `STATE_VERSION` stays 2 and the main window's role as the only writer of
state is untouched.

```
<data dir>/artifacts/<sessionId>/
  index.json                       the session's artifacts
  <artifactId>/<version>.html      a stored copy, mode 0600
```

`index.json` lists, per artifact: `id` (random, made by the backend), `title`,
`sourcePath` (canonical), and `versions` (`n`, `at`, `bytes`, newest last).
Every write is atomic (write, then rename): the page first, then the index. One
lock per session orders the writes.

Rules:

- Content equal to the newest version makes no new version.
- An artifact keeps its newest 20 versions and at most 64 MiB in all; older
  versions go first, the newest always stays.
- A session holds at most 50 artifacts; the next one is refused with a reason.
- Version numbers never repeat within an artifact.

Commands (all `#[tauri::command(async)]`): `artifact_show` (above; returns the
artifact with its new version), `artifact_list(sessionIds)` (each session's
index, for the tab and the gallery), `artifact_rename`, `artifact_delete`,
`artifact_delete_session` and `artifact_export`. Each change emits
`artifacts-changed` (`{ sessionId }`).

Lifecycle: archiving a session keeps its artifacts; deleting it calls
`artifact_delete_session`. At start, on its own thread, the backend removes
artifact folders whose session id is not in `state.json` and that are over a
day old.

## 4. Screens

Copy is sentence case. No keyboard shortcuts. Look follows the v2 surfaces and
`components/ui/` primitives. The canvas "Zorvo redesign v2" has four artboards
for these screens (section 10: `ArtifactsMain`, `ArtifactsGallery`,
`ArtifactsInspector`, `ArtifactsStates`), with local copies in
`2026-11-16-artifacts-artboards/`. They decide look and wording; this spec
decides behaviour. The page inside the frame is a stand-in drawn as markup.

### Artifacts tab

Offered only while the session has an artifact, main window only.

- **Tab strip**: Artifacts sits between Files and Terminal, with the number of
  artifacts. Five tabs need about 370 px, so the strip's tabs use 8 px side
  padding (they fit the default 380 px inspector), and below that width the
  strip scrolls sideways; no tab is hidden or cut.
- **List**: title, version, time. A click opens the viewer in the list's place,
  as the file viewer does. A session with one artifact opens straight on it.
- **Viewer**: the frame fills the tab and the inspector widens like the
  Terminal tab. Its header has Back, the title, a version menu ("Version 3 of
  5"; an older version is marked as older), **Reload**, **Expand** / **Shrink**
  (the page takes the chat's place and comes back), **Export**, and a ⋯ menu
  with **Rename** and **Delete artifact** (which asks first).

### When the agent calls the tool

- A **new artifact** in the session on screen: the inspector shows the
  Artifacts tab on it. Typing focus stays in the composer.
- A **new version** of the artifact the viewer shows: the page is replaced in
  place.
- Anything else: nothing moves. Zorvo never switches sessions for an artifact.

### Card in the chat

At the call, the chat gets a row Zorvo makes: the title, "Version 2" and
**Open**, which shows that version. A card whose artifact was deleted reads
"Removed". Rewinding removes the card with its message; the artifact stays.

### Gallery

**Artifacts** in the sidebar, a row under New session and above the filter,
with the number of artifacts and shown while any session has one, opens a page
in the chat's place: every artifact
of every session, newest first, with a search by title. A row shows the title,
the session's name, the agent and the time; an archived session's artifacts are
marked. A click selects the session and opens its tab. It is derived from
`artifact_list` joined with the sessions; it stores nothing.

### Export

`artifact_export(sessionId, artifactId, version)` opens the macOS save dialog
from Rust and writes the stored copy, byte for byte, to the place chosen. The
webview sends no destination. **Export** first opens a small panel under its
button: "Export this page", then "Saves Version 3 as one HTML file. An exported
page opens in a browser without Zorvo's limits.", with **Cancel** and **Choose
where to save**; only the second calls the command.

### Other states

A version whose file is gone says it is no longer on this Mac, never an empty
frame. A broken or blank page is shown as it is. A failed command becomes a
notice in plain words, never a path or an error from the backend.

## 5. Code layout

- Rust: `src-tauri/src/artifacts/` (`store.rs`, `source.rs` for the path
  checks, `protocol.rs` for the scheme and its CSP, `commands.rs`), two entries
  in `agent_tools/tools.rs`.
- Frontend: `lib/artifacts.ts` (pure rules: gallery order, card text, limits'
  wording), `hooks/useArtifacts.ts`, `components/artifacts/` (`ArtifactsPanel`,
  `ArtifactViewer`, `ArtifactCard`, `ArtifactGallery`), the two answers in
  `useAgentTools`, an `artifacts` tab in `useInspector`.

## 6. Testing

- **Rust unit**: the path rules (inside the session folder and the temporary
  folder accepted; outside, a symlink that leaves, a pipe, another extension,
  over 16 MiB, invalid UTF-8 refused); versions (equal content, the 21st
  version, the 64 MiB cap); the protocol (bad ids are 404, and a test pins the
  CSP text so loosening it is a visible change); the start-up sweep.
- **Rust integration**: `tools/list` offers the two tools; the fake agent as
  an MCP client through a real bridge (`FAKE_ACP_MCP_CALL`) and through
  `zorvo tools` gets the call parked and answered.
- **Vitest**: `lib/artifacts.ts`; opening rules (a new artifact shows the tab,
  a new version does not change tabs, another session is never selected); the
  card; the gallery. The Tauri contract test covers the new commands and the
  `artifacts-changed` event.
- **Real app**: with the existing harness, a page loads in the frame, a CDN
  script runs, `fetch` is blocked, and the three IPC attempts of the spike
  fail.

## 7. Order of work

| # | Step | Done when |
| --- | --- | --- |
| 0 | Sandbox spike | The three questions have evidence; the code is thrown away |
| 1 | Backend | Store, path checks, protocol with its CSP, sweep, export |
| 2 | Tools | `show_artifact`, `artifact_guide`, Pi's command path |
| 3 | Screens | Tab, viewer, versions, chat card, opening rules |
| 4 | Gallery and guide | Gallery page; the guide revised from real agents' pages |

## 8. Documents that change

`tauri.conf.json` (`frame-src`), the README's privacy section and CLAUDE.md
(the artifact frame loads scripts and fonts from the listed hosts; the main
webview still makes no request), `CHANGELOG.md` under `Unreleased`.
