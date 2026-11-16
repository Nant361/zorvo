# Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent hands Zorvo an HTML file with `show_artifact`; Zorvo keeps versioned copies, shows the page sandboxed in an Artifacts tab, lists every session's pages in a gallery and exports one as a file.

**Architecture:** A Rust module `artifacts/` owns storage (`<data dir>/artifacts/<sessionId>/`), the path checks and a custom `zorvo-artifact` protocol that serves a stored copy with its own CSP. Two tools join the agent tool server and are answered by the webview through the existing `agent-tool-call` path. The frontend reads through commands and an `artifacts-changed` event; nothing is added to `state.json`.

**Tech Stack:** Tauri 2.12 / wry 0.57 (custom URI scheme, plugin `on_navigation`, `tauri-plugin-dialog` from Rust), React 19, Vitest, the fake ACP agent.

**Spec:** `docs/superpowers/specs/2026-11-16-artifacts-design.md`. Read it first; this plan argues from it.

## Global Constraints

- The webview sends ids, a folder and the agent's path string only; never a storage path, a destination or a URL. Every command that takes a folder calls `files::ensure_known_workspace` first.
- Limits, verbatim: page at most 16 MiB; 20 versions and 64 MiB per artifact; 50 artifacts per session; title at most 60 characters; path at most 4096 characters.
- Id shapes: session `[A-Za-z0-9_-]{1,80}`; artifact `a-` plus 16 lowercase hex characters, made by the backend with the generator `agent_tools/socket.rs`'s `random_token` uses.
- A sentence for the agent never repeats what the agent sent (no path, no title).
- `STATE_VERSION` stays 2. `Session` gets no new field.
- UI: sentence case, `components/ui/` primitives, `focus-ring`, tokens only, `sheet`/`chip` surfaces, no keyboard shortcuts. Main window only; popouts get nothing.
- Commands that touch disk are `#[tauri::command(async)]`.
- Run only the tests of the files you touched (`pnpm vitest run <file>`, `cargo test <filter>`); CI runs the rest. Stage explicit paths, never `git add -A`. Conventional Commits.
- Work on branch `feat/artifacts` in its own worktree.

## Review Focus

1. **A page that never yields** (`while(true){}`): the user expects Zorvo to stay usable. Spike question 4 decides what is possible; Task 8 tests whatever was decided.
2. **Two `show_artifact` calls for one path in the same tick**: one artifact with two versions, never two artifacts. Test in Task 1.
3. **A version pruned or a session deleted while its page is on screen**: the viewer says the version is no longer on this Mac; the gallery row goes. Tests in Tasks 8 and 10.
4. **A path the agent writes loosely** (`~/x.html`, relative, with `..`, a symlink out of the folder, a folder named `x.html`): relative resolves against the session folder, the rest are refused with the one fixed sentence. Tests in Task 2.
5. **A title made of control or bidi characters, or blank after cleaning**: shown escaped; blank counts as missing. Tests in Tasks 1 and 7.

---

### Task 0: Sandbox spike (gate, throwaway)

Nothing from this task is merged. Work in a scratch worktree and report.

- [ ] **Step 1:** Add, crudely, a `zorvo-artifact` scheme that serves one hard-coded HTML string with the spec's CSP header, `frame-src zorvo-artifact:` in `tauri.conf.json`'s CSP, a plugin with `on_navigation` that logs every URL it is asked about and refuses `http(s)` ones other than the dev URL, and an `<iframe sandbox="allow-scripts">` on any screen. Build with `pnpm tauri build --debug --config '{"bundle":{"createUpdaterArtifacts":false}}'` so the production CSP applies.
- [ ] **Step 2:** Serve pages that try each item and write the outcome into the page body. Record what the app shows and what stderr logs.
  1. `typeof window.__TAURI_INTERNALS__`; `fetch('ipc://localhost/get_agent_profiles')`; `window.webkit.messageHandlers.ipc.postMessage(...)` with a hand-built invoke message for `get_agent_profiles`.
  2. `location.href = 'https://example.com'`, a clicked `<a href>`, a `<meta http-equiv="refresh">`. Note whether the handler was called for the frame and which URLs it sees during a normal start (`about:blank`, `tauri://localhost`).
  3. Tailwind CDN, Chart.js, D3, Mermaid (pinned versions from cdnjs or jsDelivr) and one Google Font render. Note any CSP violation, especially `unsafe-eval`.
  4. `while(true){}` in the page: can the main UI still be clicked and typed in? Does removing the iframe recover it?
- [ ] **Step 3:** Write the findings into the spec's "Spike" section as results (pass or fail, with the evidence) and commit that doc change on `docs/artifacts-spec`. **Stop and report to the user if 1 fails, if 4 freezes the app, or if 3 needs `unsafe-eval`.** Otherwise the allowed navigation URLs and the final CSP text recorded there are what Task 3 implements.

---

### Task 1: The store

**Files:** Create `src-tauri/src/artifacts/mod.rs`, `src-tauri/src/artifacts/store.rs`. Modify `src-tauri/src/lib.rs` (`pub mod artifacts;`).

**Interfaces — produces:**

```rust
pub const MAX_VERSIONS: usize = 20;
pub const MAX_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_ARTIFACTS: usize = 50;
pub const MAX_TITLE_CHARS: usize = 60;
pub const NEEDS_TITLE: &str = "Give the page a title the first time you show it.";
pub const TOO_MANY: &str = "This session already has 50 pages. The user can delete one in Zorvo.";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] #[serde(rename_all = "camelCase")]
pub struct ArtifactVersion { pub n: u32, pub at: u64, pub bytes: u64 }
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] #[serde(rename_all = "camelCase")]
pub struct ArtifactRecord { pub id: String, pub title: String, pub source_path: String, pub versions: Vec<ArtifactVersion> }
#[derive(Serialize, Clone, Debug)] #[serde(rename_all = "camelCase")]
pub struct Shown { pub artifact: ArtifactRecord, pub version: u32, pub is_new_artifact: bool, pub is_new_version: bool }

pub fn is_session_id(id: &str) -> bool;
pub fn is_artifact_id(id: &str) -> bool;

pub struct ArtifactStore { /* root, one Mutex per session id */ }
impl ArtifactStore {
    pub fn new(root: PathBuf) -> Self;                       // <data dir>/artifacts
    pub fn show(&self, session_id: &str, source_path: &str, title: Option<&str>, html: &[u8], now_ms: u64) -> Result<Shown, String>;
    pub fn list(&self, session_id: &str) -> Result<Vec<ArtifactRecord>, String>;   // newest-changed first; [] when none
    pub fn rename(&self, session_id: &str, artifact_id: &str, title: &str) -> Result<ArtifactRecord, String>;
    pub fn delete(&self, session_id: &str, artifact_id: &str) -> Result<(), String>;
    pub fn delete_session(&self, session_id: &str) -> Result<(), String>;
    pub fn version_path(&self, session_id: &str, artifact_id: &str, version: u32) -> Option<PathBuf>; // only a version the index lists
    pub fn sweep_orphans(&self, known_sessions: &HashSet<String>, now: SystemTime, min_age: Duration) -> usize;
}
```

Layout: `<root>/<sessionId>/index.json` (a JSON array of `ArtifactRecord`) and `<root>/<sessionId>/<artifactId>/<n>.html`, mode 0600, written with `store::atomic_write`, page before index. A missing or unreadable index reads as empty for `list` and as an error for `show` only when it exists and does not parse. Titles are trimmed and cut to 60 characters; blank is missing. The next version number is the last `n` plus one, so numbers never repeat after pruning.

- [ ] **Step 1: Failing tests** in `store.rs`'s `#[cfg(test)]` (temp dir per test, as `pasted_images.rs` does):
  - `first_show_needs_a_title`: `show(.., None, ..)` on a new path is `Err(NEEDS_TITLE)`; a blank title too.
  - `same_path_makes_a_new_version`: two different bodies → one record, versions `[1, 2]`, `is_new_artifact` true then false.
  - `equal_content_makes_no_version`: same bytes twice → versions `[1]`, second `is_new_version == false`; a new title on that call still renames.
  - `another_path_is_another_artifact`.
  - `keeps_the_newest_20_versions`: 21 shows → versions `2..=21`, file `1.html` gone, `21.html` present.
  - `drops_old_versions_over_64_mib_but_keeps_the_newest`: five 15 MiB bodies → the files kept sum to at most 64 MiB and include the last.
  - `refuses_the_51st_artifact`: `Err(TOO_MANY)`; a new version of an existing one still works.
  - `two_shows_at_once_for_one_path_make_one_artifact`: two threads, different bodies → one record, two versions.
  - `version_path_is_only_for_listed_versions`: `None` for a bad session id (`../x`), a bad artifact id, version 0, a pruned version.
  - `delete_and_delete_session_remove_the_files`.
  - `sweep_removes_only_unknown_sessions_older_than_the_age`.
  - `pages_are_private_to_the_user` (mode 0600).
- [ ] **Step 2:** `cargo test artifacts::store` → fails to compile.
- [ ] **Step 3:** Implement to the interface.
- [ ] **Step 4:** `cargo test artifacts::store` → all pass; `cargo clippy --all-targets -- -D warnings`.
- [ ] **Step 5:** Commit `feat: store versioned artifact pages per session`.

---

### Task 2: Reading the agent's file

**Files:** Create `src-tauri/src/artifacts/source.rs`.

**Interfaces — produces:**

```rust
pub const MAX_PAGE_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_PATH_CHARS: usize = 4096;
pub const NOT_ALLOWED: &str = "That is not an HTML file in this session's folder or the temporary folder.";
pub const TOO_LARGE: &str = "The page is over 16 MB.";
pub const NOT_TEXT: &str = "The page is not valid UTF-8 text.";

pub fn temp_roots() -> Vec<PathBuf>;   // canonical std::env::temp_dir() and /private/tmp, deduped
/// Returns the canonical path (the artifact's identity) and the bytes.
pub fn read_source(session_folder: &Path, temp_roots: &[PathBuf], path: &str) -> Result<(String, Vec<u8>), String>;
```

`session_folder` is already canonical. A relative `path` joins it. The canonical result must start with the session folder or a temp root, be a regular file by metadata (never opened otherwise), and end in `.html` or `.htm` (ASCII case-insensitive). Read at most `MAX_PAGE_BYTES + 1`.

- [ ] **Step 1: Failing tests:** `accepts_a_file_in_the_session_folder`, `accepts_a_relative_path`, `accepts_a_file_in_a_temp_root`, and each of these is `Err(NOT_ALLOWED)`: a file outside both, `..` that leaves, a symlink inside the folder to a file outside, a directory named `x.html`, a FIFO named `x.html` (must return, not block), `notes.txt`, a missing file, `~/x.html`, a path over 4096 characters. `refuses_a_page_over_16_mib` → `TOO_LARGE`; `accepts_a_page_of_exactly_16_mib`; `refuses_invalid_utf8` → `NOT_TEXT`. One test asserts no error string contains the path given.
- [ ] **Step 2:** `cargo test artifacts::source` → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass; clippy clean.
- [ ] **Step 5:** Commit `feat: read an artifact's source file under path rules`.

---

### Task 3: The protocol, its CSP and navigation

**Files:** Create `src-tauri/src/artifacts/protocol.rs`. Modify `src-tauri/src/lib.rs` (register the scheme and the plugin), `src-tauri/tauri.conf.json` (append `; frame-src zorvo-artifact:` to `csp`).

**Interfaces — produces:**

```rust
pub const SCHEME: &str = "zorvo-artifact";
pub const PAGE_CSP: &str = /* the spec's policy on one line, as fixed by the spike */;
pub fn parse_url(uri: &str) -> Option<(String, String, u32)>;        // zorvo-artifact://localhost/<session>/<artifact>/<version>[?query]
pub fn respond(store: &ArtifactStore, method: &str, uri: &str) -> tauri::http::Response<Vec<u8>>;
pub fn is_allowed_navigation(url: &tauri::Url) -> bool;              // the URLs the spike recorded, and zorvo-artifact://localhost/
pub fn navigation_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R>;
```

`respond`: 200 with the page and headers `Content-Type: text/html; charset=utf-8`, `Content-Security-Policy: PAGE_CSP`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; 404 with an empty body for a method other than GET, a URL that does not parse, or a version `version_path` does not give. `lib.rs` registers `SCHEME` with a handler that takes `ArtifactStore` from `try_state` (404 before setup has managed it).

- [ ] **Step 1: Failing tests:** `serves_a_stored_version_with_its_headers` (all four headers, body equal); `the_page_csp_is_exactly` (asserts the full `PAGE_CSP` string, so a change to it is a visible diff); `refuses_post`, `refuses_a_bad_session_id`, `refuses_an_unlisted_version`, `refuses_another_host` → 404; `parse_url_ignores_the_query`; `navigation_allows_the_app_and_artifacts` and `navigation_refuses_websites` (`https://example.com`, `http://example.com`, `file:///etc/hosts`). Extend the existing test that reads `tauri.conf.json`'s CSP, or add one, asserting it contains `frame-src zorvo-artifact:` and still `script-src 'self'`.
- [ ] **Step 2:** `cargo test artifacts::protocol` → fails.
- [ ] **Step 3:** Implement and wire into `lib.rs`.
- [ ] **Step 4:** Tests pass; clippy clean; `pnpm tauri dev` still opens the main window and a popout (navigation not broken).
- [ ] **Step 5:** Commit `feat: serve artifact pages on a sandboxed protocol`.

---

### Task 4: Commands, the event, the sweep and export

**Files:** Create `src-tauri/src/artifacts/commands.rs`. Modify `src-tauri/src/lib.rs` (manage `ArtifactStore::new(data_dir.join("artifacts"))` in `setup` beside the other stores, add the commands to `generate_handler!`, spawn the sweep next to the pasted-images sweep with the session ids from `load_state()`, skipped when the state does not load).

**Interfaces — produces** (JS argument names are the camelCase of these):

```rust
artifact_show(app, store, artifacts, session_id: String, cwd: String, path: String, title: Option<String>) -> Result<Shown, String>
artifact_list(artifacts, session_ids: Vec<String>) -> Result<Vec<SessionArtifacts>, String>   // { sessionId, artifacts }
artifact_rename(app, artifacts, session_id: String, artifact_id: String, title: String) -> Result<ArtifactRecord, String>
artifact_delete(app, artifacts, session_id: String, artifact_id: String) -> Result<(), String>
artifact_delete_session(app, artifacts, session_id: String) -> Result<(), String>
artifact_export(app, artifacts, session_id: String, artifact_id: String, version: u32) -> Result<bool, String>  // false: the user cancelled
```

`artifact_show`: `ensure_known_workspace(cwd)`, `is_session_id`, `read_source`, `store.show`. Every changing command emits `artifacts-changed` with `{ "sessionId": … }`. `artifact_export` uses `tauri_plugin_dialog::DialogExt` (`app.dialog().file().set_file_name(<title cleaned to a file name>.html).add_filter("HTML", &["html"]).blocking_save_file()`), then copies the stored bytes; no capability changes. Keep the logic in plain functions the commands call, so it is testable without Tauri. `SWEEP_MIN_AGE` is one day.

- [ ] **Step 1: Failing tests** for the plain functions: `show_refuses_an_unknown_workspace`, `show_refuses_a_bad_session_id`, `show_stores_what_the_file_held`, `list_returns_each_session_asked_for`, `export_name_is_safe` (`"Q3 / report: final"` → `Q3 report final.html`; blank → `Artifact.html`).
- [ ] **Step 2:** `cargo test artifacts::commands` → fails.
- [ ] **Step 3:** Implement and register.
- [ ] **Step 4:** Tests pass; clippy; `cargo fmt --check`.
- [ ] **Step 5:** Commit `feat: add artifact commands, export and the start-up sweep`.

---

### Task 5: The two tools

**Files:** Modify `src-tauri/src/agent_tools/tools.rs`, `src-tauri/src/agent_tools/cli.rs` (the tool list and examples printed with no tool), `src/lib/agent-tools-context.ts`. Test: `tools.rs` unit tests, `src-tauri/tests/it/agent_tools_e2e_test.rs`, `agent_tools_cli_test.rs`, `src/test/` file that pins `COMMAND_PATH_CONTEXT`.

**Interfaces — produces:** `TOOL_NAMES` has seven entries, adding `"show_artifact"` and `"artifact_guide"`. `validate("show_artifact", …)` returns `{ path, title? }`: `path` required, trimmed, 1 to 4096 characters; `title` optional, through the existing `put_title`. `validate("artifact_guide", …)` takes no arguments.

Descriptions, verbatim:

- `show_artifact`: "Show the user a web page you wrote, beside the chat. Write one self-contained .html file in this folder or the temporary folder, then call this with its path. Calling it again for the same path shows a new version. Scripts may come only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm/, unpkg.com, cdn.tailwindcss.com and code.jquery.com, with an exact version; fonts from Google Fonts; images as data URIs. The page cannot fetch anything or keep data. Call artifact_guide before your first page."
- `artifact_guide`: "How to design a page for show_artifact: colours for light and dark, layout, charts. Read it once before your first page."

Add to `COMMAND_PATH_CONTEXT`, before "Use these only when…": `'show_artifact {"path": "<file.html>", "title": "<text>"} shows the user a web page you wrote; run artifact_guide first. '` and change the closing sentence to "Use the agent tools only when the user asks for another agent or a new session, and show_artifact when a page explains something better than text. Do not mention this note."

- [ ] **Step 1: Failing tests:** `tool_list_names_seven_tools`; `show_artifact_needs_a_path`; `show_artifact_refuses_an_unknown_argument`; `show_artifact_refuses_a_path_over_the_cap` (error does not contain the path); `artifact_guide_takes_no_arguments`. In `agent_tools_e2e_test.rs`: with `FAKE_ACP_MCP_CALL={"tool":"show_artifact","args":{"path":"p.html","title":"T"}}`, the parked call's event carries tool `show_artifact` and the cleaned args. In `agent_tools_cli_test.rs`: `zorvo tools` with no tool lists both names. Vitest: the context names `show_artifact` and `artifact_guide`.
- [ ] **Step 2:** Run those tests → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat: offer show_artifact and artifact_guide to agents`.

---

### Task 6: Frontend model

**Files:** Create `src/lib/artifacts.ts`, `src/hooks/useArtifacts.ts`. Modify `src/types/index.ts`, `src/lib/persistence.ts` (keep a valid `artifactCard` when normalising a transcript, drop a malformed one), `src/test/setup.ts` (fake the six commands with an in-memory map). Test: `src/test/artifacts.test.ts`, `src/test/useArtifacts.test.tsx`.

**Interfaces — produces:**

```ts
// types/index.ts
export interface ArtifactVersion { n: number; at: number; bytes: number }
export interface Artifact { id: string; title: string; sourcePath: string; versions: ArtifactVersion[] }
export interface ArtifactCard { artifactId: string; title: string; version: number }
// ChatMessage gains: artifactCard?: ArtifactCard

// lib/artifacts.ts
export interface ShownArtifact { artifact: Artifact; version: number; isNewArtifact: boolean; isNewVersion: boolean }
export interface ViewedArtifact { artifactId: string; version: number | null }   // null follows the newest
export function parseArtifacts(value: unknown): Artifact[];           // lenient: drops what does not fit
export function parseShown(value: unknown): ShownArtifact | null;
export function artifactUrl(sessionId: string, artifactId: string, version: number, reload = 0): string; // zorvo-artifact://localhost/s/a/3?r=0
export function newestVersion(artifact: Artifact): number;
export function versionLabel(version: number, artifact: Artifact): string;   // "Version 3 of 5", 5 = newest n
export function hasVersion(artifact: Artifact | undefined, version: number): boolean;
export function shownResultText(shown: ShownArtifact): string;        // JSON: { title, version, shown: true }
export function openingFor(input: { isOnScreen: boolean; shown: ShownArtifact; viewed: ViewedArtifact | null }): 'show-tab' | 'replace' | 'none';
export function cardState(card: ArtifactCard, artifacts: readonly Artifact[]): 'open' | 'removed';
export interface GalleryRow { sessionId: string; sessionName: string; agentName: string; isArchived: boolean; artifact: Artifact; at: number }
export function galleryRows(sessions: readonly Session[], bySession: ReadonlyMap<string, readonly Artifact[]>, agentNameOf: (id: string) => string): GalleryRow[]; // newest first; a session not in `sessions` gives no row
export function filterGallery(rows: readonly GalleryRow[], query: string): GalleryRow[];   // title, case-insensitive

// hooks/useArtifacts.ts
export function useArtifacts(sessionIds: readonly string[]): { bySession: ReadonlyMap<string, readonly Artifact[]>; error: boolean };
```

`openingFor`: `show-tab` when on screen and `isNewArtifact`; `replace` when on screen, `viewed` is this artifact with `version === null`; else `none`. `useArtifacts` calls `artifact_list` when the id list changes and refetches one session on its `artifacts-changed`; an answer that arrives for an older request is dropped.

- [ ] **Step 1: Failing tests** covering each function's rule above, plus: `parseArtifacts` drops an entry without versions or with a bad id; `galleryRows` orders by the newest version's `at` and marks archived sessions; `openingFor` is `none` for another session and for an older pinned version; the hook refetches on the event and ignores an event for a session it was not given.
- [ ] **Step 2:** `pnpm vitest run src/test/artifacts.test.ts src/test/useArtifacts.test.tsx` → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Those tests and `src/test/tauri-contract.test.ts`, `src/test/persistence.test.ts` pass; `pnpm lint`.
- [ ] **Step 5:** Commit `feat: add the artifact model and its hook`.

---

### Task 7: Answering the tools

**Files:** Create `src/lib/artifact-guide.md` (imported with `?raw`). Modify `src/hooks/useAgentTools.ts`, `src/lib/agent-tool-card.ts` or a new `src/lib/artifact-card.ts` for the message helper, `src/App.tsx` (pass the new dep). Test: `src/test/useAgentTools.artifacts.test.tsx`, `src/test/artifact-guide.test.ts`.

**Interfaces — consumes:** Task 4's `artifact_show`, Task 6's `parseShown`, `shownResultText`. **Produces:**

```ts
// AgentToolsDeps gains
onArtifactShown: (sessionId: string, shown: ShownArtifact) => void;
// lib/artifact-card.ts
export function withArtifactCard(messages: ChatMessage[], shown: ShownArtifact, now: number): ChatMessage[];
```

In the dispatch, after the session checks that already exist: `artifact_guide` answers `respond(callId, true, guide)`. `show_artifact` invokes `artifact_show` with `{ sessionId, cwd: session.cwd, path, title }` where the title has been through `escapeVisible` (blank → omitted); on success it adds the card with `updateMessages` (`withArtifactCard` appends a message of role `agent`, `isComplete: true`, with `artifactCard`, the way `withToolCard` places Zorvo's own cards; equal content, `isNewVersion` false, adds no card), calls `onArtifactShown`, and answers `shownResultText`. A rejection whose text is one of the backend's fixed sentences is passed to the agent as it is with `ok: false`; anything else answers `FAILED` and goes to `onNotice`.

The guide, first version, under 6,000 characters, plain instructions: one file; a `<title>`; colour tokens on `:root` with a `prefers-color-scheme: dark` block and an explicit page background; system font stack unless a Google Font is linked; fluid layout that holds from 320 px to wide with no horizontal scroll; the CDN list with exact versions; no `fetch`, no `localStorage`, no links that leave the page; charts need labels, a legend and text that stays readable in both themes; prefer inline SVG for diagrams.

- [ ] **Step 1: Failing tests:** `artifact_guide_answers_the_guide`; `show_artifact_stores_and_answers` (fake backend → answer JSON has `version: 1`, `shown: true`; one card message; `onArtifactShown` called once); `a_refusal_reaches_the_agent_in_the_backends_words`; `an_unexpected_failure_answers_FAILED_and_notifies`; `equal_content_adds_no_card`; `a_title_of_control_characters_is_escaped`; `a_session_without_tools_is_told_NO_SESSION` for both tools. `artifact-guide.test.ts`: the guide is under 6,000 characters and names every host in the tool description.
- [ ] **Step 2:** Run both files → fail.
- [ ] **Step 3:** Implement; write the guide.
- [ ] **Step 4:** Tests pass; `pnpm lint`.
- [ ] **Step 5:** Commit `feat: answer show_artifact and artifact_guide`.

---

### Task 8: The Artifacts tab and viewer

**Files:** Create `src/components/artifacts/ArtifactsPanel.tsx`, `ArtifactViewer.tsx`, `ArtifactFrame.tsx`. Modify `src/lib/inspector.ts` (`InspectorTab` gains `"artifacts"`), `src/components/inspector/Inspector.tsx` (label "Artifacts", order after `files`, count), `src/hooks/useInspector.ts`, `src/App.tsx` (offer the tab while the session has an artifact; `onArtifactShown` applies `openingFor`; Expand shows the viewer in the chat's place as the full review does). Test: `src/test/ArtifactsPanel.test.tsx`, `src/test/useInspector.artifacts.test.tsx`.

**Interfaces — produces** on `InspectorState`: `viewedArtifact: ViewedArtifact | null`, `viewArtifact(view: ViewedArtifact | null): void` (widens the inspector as `viewFile` does; another session clears it), `isArtifactExpanded: boolean`, `setArtifactExpanded(v: boolean)`.

`ArtifactFrame` renders `<iframe sandbox="allow-scripts" title={artifact.title} src={artifactUrl(...)}>`; Reload bumps the `reload` number. Before rendering the frame the viewer checks `hasVersion`; when false it shows "This version is no longer on this Mac." Copy: tab "Artifacts"; "Version 3 of 5"; "Older version"; buttons "Reload", "Expand", "Shrink", "Export"; menu "Rename", "Delete artifact"; confirm "Delete this artifact and its versions? This cannot be undone." with "Delete" and "Cancel"; under Export's control: "An exported page opens in a browser without Zorvo's limits." If spike question 4 required a mitigation, it is implemented here and tested.

- [ ] **Step 1: Failing tests:** the tab is offered only with an artifact; one artifact opens straight on the viewer, two show the list; the frame has `sandbox="allow-scripts"` exactly and the expected `src`; the version menu switches `src` and marks an older version; a new version replaces the page when following the newest and not when an older one is pinned; a pruned version shows the sentence and no iframe; Delete asks first, then invokes `artifact_delete`; Export invokes `artifact_export` with ids and version only; a new artifact in the session on screen shows the tab and leaves focus in the composer; one in another session changes nothing.
- [ ] **Step 2:** Run both files → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass, plus `src/test/design-tokens.test.ts`, `sheet-fills.test.ts`; `pnpm lint`.
- [ ] **Step 5:** Commit `feat: show artifacts in an inspector tab`.

---

### Task 9: The card in the chat

**Files:** Create `src/components/chat/ArtifactCardRow.tsx`. Modify the message row component that renders `actionCard`/`elicitation` (`src/components/chat/MessageRow.tsx`) and `src/App.tsx` (Open → `inspector.show('artifacts')` and `viewArtifact({ artifactId, version })`). Test: `src/test/ArtifactCardRow.test.tsx`.

- [ ] **Step 1: Failing tests:** the row shows the title and "Version 2" and an "Open" button that calls `onOpen(card)`; with `cardState` `removed` it reads "Removed" and has no button; a popout (no `onOpen`) shows the row without the button.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass; `pnpm lint`.
- [ ] **Step 5:** Commit `feat: mark each shown artifact in the chat`.

---

### Task 10: The gallery and session deletion

**Files:** Create `src/components/artifacts/ArtifactGallery.tsx`. Modify `src/components/Sidebar.tsx` (an "Artifacts" entry, shown while any session has one), `src/App.tsx` (the gallery takes the chat's place, as Settings does; the composer is hidden, not unmounted; a row click selects the session, leaves the gallery, shows the tab on that artifact), and the session-delete path that calls `delete_transcript` (also invoke `artifact_delete_session`; a failure is a notice, not a blocked delete). Test: `src/test/ArtifactGallery.test.tsx`, and one case in the test that covers deleting a session.

Copy: heading "Artifacts"; search placeholder "Search artifacts"; row: title, "{session} · {agent}", relative time, "Archived" mark; empty search: "No artifacts match."

- [ ] **Step 1: Failing tests:** rows are newest first across two sessions; search filters by title; an archived session's row is marked; a click calls `onOpen(sessionId, artifactId)`; a session removed from the list takes its rows with it; deleting a session invokes `artifact_delete_session` with its id.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass; `pnpm lint`.
- [ ] **Step 5:** Commit `feat: list every session's artifacts in a gallery`.

---

### Task 11: Real app, real agents, documents

**Files:** Modify `README.md` (privacy section), `CLAUDE.md` (an **Artifacts** paragraph in Architecture; the Project rules' network sentence), `CHANGELOG.md` (`Unreleased`), `src/lib/artifact-guide.md`.

- [ ] **Step 1:** Rebuild the real-app harness (a scratch HOME, a fake agent on PATH; the fake agent writes a page with `FAKE_ACP_WRITE_FILES` and calls the tool with `FAKE_ACP_MCP_CALL`). Show, with what the page prints and a screenshot: the page loads in the tab; a CDN script ran; `fetch('https://example.com')` was blocked; the three IPC attempts of the spike fail; a second call shows version 2; Export writes the same bytes (`cmp`). Keep the harness script in the session scratchpad and say where in the PR.
- [ ] **Step 2:** With Claude Code, Codex and Antigravity, ask each for the same three pages (a report with a chart, a diagram, a small dashboard). Note what looks wrong in light and dark and at the inspector's narrow width; revise the guide; repeat once. Put before/after screenshots in the PR.
- [ ] **Step 3:** Write the documents. The privacy sentence: the artifact frame loads scripts from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, cdn.tailwindcss.com and code.jquery.com and fonts from Google Fonts when a page asks for them; Zorvo's own interface still makes no request. Run `pnpm vitest run src/test/public-docs` if a docs test covers the README.
- [ ] **Step 4:** Commit `docs: describe artifacts and what their pages may load`.
