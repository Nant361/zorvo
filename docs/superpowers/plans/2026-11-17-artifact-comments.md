# Artifact Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user marks text or an element on an artifact page, writes a comment in a strip under the page, and sends it to the agent through the composer, as Diff comments are sent.

**Architecture:** A script of Zorvo's own runs in the artifact's child webview (wry `with_initialization_script`) and reports picks through a data-only wry IPC handler; Rust checks each message and emits `artifact-page-pick`. Rust sends numbered marks back with `evaluate_script`. Comments are `Session.artifactComments`, worded by a pure `lib/artifact-comments.ts`, held by an App-level hook, and added to the composer through the slot Diff comments already use.

**Tech Stack:** wry 0.57 (child webview), Tauri 2, React 19, Vitest with jsdom, serde.

**Spec:** `docs/superpowers/specs/2026-11-17-artifact-comments-design.md`, on top of `docs/superpowers/specs/2026-11-16-artifacts-design.md`. Read both first; this plan argues from them.

## Global Constraints

- Branch `feat/artifact-comments`, made from `feat/artifacts` (or from `main` once PR zakyirsyaad/zorvo#230 has merged), in its own worktree.
- The webview sends Rust ids, a version, `on`, and marks built from saved comments. It never sends a script, a URL or comment text. Comment text never reaches the page, a log or an exported file.
- Limits from the spec, verbatim: a page message at most 16 KiB; `quote` at most 1000 characters; `before` and `after` at most 60 each; at most 5 `classes`; element `text` at most 200; `path` at most 12 levels; `marks-missing` at most 200 numbers; more than 5 messages in a second dropped; at most 200 artifact comments per session; a comment's text at most `MAX_COMMENT_LENGTH` (2000); the strip at most 40% of the viewer's height.
- Limits this plan sets (the spec says only "within its limit"): `tag` matches `^[a-z][a-z0-9-]{0,31}$`; `elementId` at most 100 characters; each class at most 60; `label` at most 100; `path` at most 1000 characters. Characters are counted as Unicode scalar values in Rust and code points in TypeScript.
- `STATE_VERSION` stays 2. Diff comment logic (`commentStatus`, `reviewMessage`, the diff panels) does not change; only `useReviewMessage`'s slot is widened.
- UI: sentence case, `components/ui/` primitives, `focus-ring`, tokens only, no keyboard shortcuts, main window only. Look and copy follow the Task 0 artboards; copy quoted here is the fallback when an artboard is silent.
- Commands that touch disk or the view are `#[tauri::command(async)]`. Every view call from the webview goes through the one queue in `useArtifactView.ts`.
- Run only the tests of the files you touched (`pnpm vitest run <file>`, `cargo test <filter>`); CI runs the rest. Stage explicit paths, never `git add -A`. Conventional Commits.

## Review Focus

1. **A page that floods `window.ipc.postMessage` with picks while comment mode is on:** Zorvo stays responsive, at most 5 a second get through, and text the user is typing is never replaced. Tests in Task 1 (rate) and Task 5 (held candidate).
2. **The agent shows a new version while the user is typing a comment:** the typed text stays, and saving keeps the anchor and version it was picked on, so the comment reads Outdated. Test in Task 5.
3. **Expand or Shrink while comment mode is on and a comment is half written:** comment mode stays on and the text stays. Test in Task 6.
4. **An artifact deleted while its comments sit in the composer:** the sweep removes them, the slot forgets their ids, and the composer's text stays. Test in Task 5.
5. **Page text with control or bidi characters, line breaks, or a line that looks like a new item ("2. On the element:"):** the quote and element lines are escaped and kept on their own lines, so nothing in them can pass for another comment. Test in Task 3.

---

### Task 0: Artboards (gate for Task 6)

**Files:** a new section on the canvas "Zorvo redesign v2" (https://claude.ai/artifact/NkShdh56RavBM73MEb9WbU), the next "Bagian" after the last one. Local copies go in `docs/superpowers/specs/2026-11-17-artifact-comments-artboards/`.

Build each artboard from an existing file in `docs/superpowers/specs/2026-11-16-artifacts-artboards/` (head, CSS, frame, header and row markup), changing only the new part. Read the canvas (`project/canvas.json`) right before publishing; a publish needs a whole-artifact read first.

- [ ] **Step 1:** `ArtifactCommentsMain`, from `ArtifactsInspector`: the viewer with **Comment** pressed, the page showing an outlined element and two numbered marks, the strip with a candidate being written and a list of three comments (Current, In message, Sent), and the footer with **Add 1 to message** and **Clear sent**.
- [ ] **Step 2:** `ArtifactCommentsStates`, from `ArtifactsStates`: an Outdated comment with "Written on Version 2; the page is now Version 3.", "Not found on the page", **Comment** disabled on an older version with "Comments go on the newest version.", a held pick ("Finish or cancel this comment first."), the 200-comment limit, and the strip in an expanded viewer.
- [ ] **Step 3:** Render-check both boards in light and dark, save the local copies, commit them on `docs/artifacts-spec` (`docs: add the artifact comments artboards`), and ask the user to approve them. Task 6 does not start before they do.

---

### Task 1: Checking what the page sends

**Files:** Create `src-tauri/src/artifacts/picks.rs`. Modify `src-tauri/src/artifacts/mod.rs` (`pub mod picks;`).

**Interfaces — produces:**

```rust
pub const ARTIFACT_PAGE_PICK: &str = "artifact-page-pick";
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;
pub const MAX_PER_SECOND: u32 = 5;
pub const MAX_MARKS: usize = 200;
// and one const per limit in Global Constraints

/// Wire form: {"kind":"pick-text","quote","before","after"},
/// {"kind":"pick-element","tag","elementId"?,"classes","label"?,"text","path"},
/// {"kind":"cancel"}, {"kind":"marks-missing","numbers"}. Field names camelCase.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum PageMessage { PickText { .. }, PickElement { .. }, Cancel, MarksMissing { numbers: Vec<u32> } }

/// {"kind":"text",...} or {"kind":"element",...}: the same fields as the picks.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum PageAnchor { Text { .. }, Element { .. } }

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PageMark { pub n: u32, pub anchor: PageAnchor }

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ViewState { pub is_commenting: bool, pub has_marks: bool }

pub fn parse_page_message(raw: &str) -> Option<PageMessage>;
pub fn checked_marks(marks: Vec<PageMark>) -> Option<Vec<PageMark>>;
pub fn is_accepted(message: &PageMessage, state: ViewState) -> bool;

#[derive(Debug, Default)]
pub struct RateLimit { /* window start and count */ }
impl RateLimit { pub fn allow(&mut self, now: std::time::Instant) -> bool; }

#[derive(Serialize, Clone, Debug)] #[serde(rename_all = "camelCase")]
pub struct PagePickEvent { pub session_id: String, pub artifact_id: String, pub version: u32, pub message: PageMessage }
```

`parse_page_message` refuses a body over `MAX_MESSAGE_BYTES`, an unknown kind, an unknown or missing field, a string over its limit, more than 5 classes, a `path` with more than 12 ` > `-separated levels, more than 200 numbers, and a number 0. `checked_marks` refuses more than 200 marks, an `n` of 0, a repeated `n`, and an anchor that breaks the same limits (one shared check per anchor). `is_accepted`: the two picks and `cancel` need `is_commenting`; `marks-missing` needs `has_marks`. `allow` lets 5 through in a window of one second, measured from the first message of the window.

- [ ] **Step 1: Failing tests** in `picks.rs`: `parses_each_kind` (one body per kind, round-tripped to the wire names above); `refuses_a_body_over_16_kib`; `refuses_an_unknown_kind_or_field`; `refuses_a_quote_of_1001_characters` (1000 passes, counted in characters with a multi-byte string); `refuses_six_classes`; `refuses_a_path_of_13_levels`; `refuses_a_tag_with_capitals_or_spaces`; `refuses_marks_missing_with_201_numbers_or_a_zero`; `picks_need_comment_mode`; `marks_missing_needs_marks`; `allows_five_a_second_then_drops` (`Instant` values made in the test: 5 allowed, the 6th at +0.5 s refused, one at +1.0 s allowed); `checked_marks_refuses_a_repeated_number_and_a_bad_anchor`.
- [ ] **Step 2:** `cargo test picks::` → fail.
- [ ] **Step 3:** Implement. Serde with `#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]` on `PageMessage` (and `rename_all = "lowercase"` on `PageAnchor`) if your serde version takes it, otherwise check by hand; the tests decide.
- [ ] **Step 4:** `cargo test picks::` passes; `cargo clippy --all-targets -- -D warnings`.
- [ ] **Step 5:** Commit `feat: check what an artifact page sends Zorvo`.

---

### Task 2: The page script, the handler and the two commands

**Files:** Create `src-tauri/src/artifacts/page_script.js`, `src-tauri/src/artifacts/page_script.rs`, `src/test/artifact-page-script.test.ts`. Modify `src-tauri/src/artifacts/view.rs`, `src-tauri/src/artifacts/commands.rs`, `src-tauri/src/artifacts/store.rs` (`list_checked`), `src-tauri/src/artifacts/mod.rs`, `src-tauri/src/lib.rs` (two entries in `generate_handler!`).

**Interfaces:**
- Consumes: Task 1's `parse_page_message`, `checked_marks`, `is_accepted`, `RateLimit`, `PagePickEvent`, `ARTIFACT_PAGE_PICK`.
- Produces:
  - `page_script.rs`: `pub const PAGE_SCRIPT: &str = include_str!("page_script.js");`, `pub fn mode_script(on: bool) -> String`, `pub fn marks_script(marks: &[PageMark]) -> String` (`window.__zorvoMarks && window.__zorvoMarks(<serde_json>)`).
  - `view.rs`: `ShownPage` gains `pub version: u32`; `pub fn set_comment_mode(app: &AppHandle, page: ShownPage, on: bool)`; `pub fn set_marks(app: &AppHandle, page: ShownPage, marks: Vec<PageMark>)`.
  - Commands: `artifact_comment_mode(app, session_id: String, artifact_id: String, version: u32, on: bool)` and `artifact_view_marks(app, session_id: String, artifact_id: String, version: u32, marks: Vec<PageMark>) -> Result<(), String>` (an invalid list is refused with "Zorvo could not mark that page." and nothing is sent).
  - `SessionArtifacts` gains `pub failed: bool`: true when the session's index exists but cannot be read (`ArtifactStore::list_checked(&self, session_id) -> Result<Vec<ArtifactRecord>, String>`, which `list` now wraps with `unwrap_or_default`).

**The script** (`page_script.js`, plain ES2019, no imports, no `eval`, no network, never names `__TAURI`) defines `window.__zorvoCommentMode(on)` and `window.__zorvoMarks(marks)` and posts with `window.ipc.postMessage(JSON.stringify(message))`:

- **Comment mode on:** capture-phase listeners on `window`. `mouseover` outlines the element under the pointer. `click` calls `preventDefault` and `stopPropagation`; a click on `html` or `body` posts `cancel`; a click while the selection is not collapsed posts nothing; any other click posts `pick-element`. `mouseup` with a non-collapsed selection inside `body` posts `pick-text`. Off removes the outline and posts nothing.
- **Text:** `quote`, `before` and `after` are cut from the concatenated text nodes of `body` (excluding the overlay), by the selection's boundary offsets, never from `Selection.toString()`, so the search for marks finds the same characters. The quote is the first 1000 characters of the selection, and `after` follows the cut.
- **Element:** `tag` lower case; `elementId`, the first 5 classes, `label` (`aria-label`, else `role`) and `text` (`textContent` with white space collapsed, at most 200) cut to their limits; `path` from the element up to and excluding `body`, each level `tag`, plus `:nth-of-type(k)` only when the parent has more than one child of that tag, keeping the 12 levels nearest the element, joined with ` > `.
- **Marks:** one overlay `div` (`data-zorvo-overlay`, `pointer-events: none`, top `z-index`) on `document.documentElement`. An element mark is found with `document.querySelector(path)`, a text mark by searching the concatenation for `before + quote + after`, then `quote` alone. Each found mark gets an outline (element) or highlight boxes (text, from `Range.getClientRects` when present) and a badge showing `n`; positions are redone on `resize`. After every call it posts `marks-missing` with the numbers it did not find (an empty list included). Colours are literal values from the Task 0 artboards.

**Rust side:** `show` adds `.with_initialization_script(PAGE_SCRIPT)` and `.with_ipc_handler(...)`. The handler runs on the main thread, ignores a message when `GENERATION` has moved on since its view was built, then `parse_page_message` → `is_accepted` with the view's `ViewState` → `RateLimit::allow`, and emits `PagePickEvent` with the shown page's ids. Thread-locals beside `VIEW`: `COMMENTING: Cell<bool>` (false on every `show`), `MARKS: RefCell<Option<(ShownPage, Vec<PageMark>)>>` (kept across views, matched by page), `MARKS_SENT: Cell<u64>` (the generation marks were last run in) and `RATE: RefCell<RateLimit>` (fresh on every `show`). `set_comment_mode` acts only when the view shows `page`; it sets `COMMENTING` and runs `mode_script` once loaded (`mark_loaded` runs it for a page still loading). `set_marks` stores, and runs `marks_script` when the view shows that page and has loaded; `mark_loaded` runs stored marks that match the page. `has_marks` is `MARKS_SENT == GENERATION`.

- [ ] **Step 1: Failing Rust tests:** `page_script_is_pinned` (SHA-256 of `PAGE_SCRIPT` equals a constant in the test, so a change to the script is a visible change; `sha2` is already a dependency) and `page_script_names_no_tauri_internals` (no `__TAURI`, no `eval(`, no `fetch(`, holds `__zorvoMarks` and `__zorvoCommentMode`); `marks_script_is_one_fixed_call` (starts with `window.__zorvoMarks && window.__zorvoMarks(`, and a quote holding `</script>` and a U+2028 stays inside a JSON string); `list_sessions_marks_an_unreadable_index_failed` (index file holding `{`) and leaves a session with no index `failed: false`.
- [ ] **Step 2: Failing Vitest** `src/test/artifact-page-script.test.ts`: load `../../src-tauri/src/artifacts/page_script.js?raw`, run it in jsdom with a fake `window.ipc.postMessage` that records. Cases: a click with comment mode off posts nothing and reaches the page's own listener; with it on, a click on a `button#export.btn` inside `main > section` (the second `section`) posts `pick-element` with `path` `main > section:nth-of-type(2) > button` and the page's listener does not run; a click on `body` posts `cancel`; a selection across two text nodes posts `pick-text` with the exact characters and 60-character context; `__zorvoMarks` with one findable element mark, one findable text mark and one gone posts `marks-missing` with only the gone number, and the overlay holds two badges; the overlay is never reported as a pick.
- [ ] **Step 3:** Run both → fail.
- [ ] **Step 4:** Implement the script, then `page_script.rs`, `view.rs`, the commands and `list_checked`. Pass the stored page's `version` into `ShownPage` from `artifact_view_show`.
- [ ] **Step 5:** `cargo test artifacts::`, the Vitest file, `cargo clippy --all-targets -- -D warnings`, `pnpm vitest run src/test/tauri-contract.test.ts` (it fails until Task 5 listens to `artifact-page-pick` and invokes the two commands; note it and go on).
- [ ] **Step 6:** Commit `feat: let an artifact page report picks and show marks`.

---

### Task 3: The comment model

**Files:** Create `src/lib/artifact-comments.ts`, `src/test/artifact-comments.test.ts`. Modify `src/types/index.ts`, `src/lib/persistence.ts`, `src/lib/artifacts.ts`, `src/components/artifacts/ArtifactsPanel.tsx` (use `shownArtifactOf`), `src/hooks/useArtifacts.ts`, `src-tauri/src/store.rs`, `src/test/persistence.test.ts`, `src/test/useArtifacts.test.tsx`.

**Interfaces — produces:**

```ts
// types/index.ts — ArtifactAnchor and ArtifactComment exactly as the spec's section 3; Session.artifactComments?: ArtifactComment[]
export interface PageRef { sessionId: string; artifactId: string; version: number }
export interface PageMark { n: number; anchor: ArtifactAnchor }
export type PageMessage =
  | { kind: 'pick-text'; quote: string; before: string; after: string }
  | { kind: 'pick-element'; tag: string; elementId?: string; classes: string[]; label?: string; text: string; path: string }
  | { kind: 'cancel' }
  | { kind: 'marks-missing'; numbers: number[] };

// lib/artifact-comments.ts
export const MAX_ARTIFACT_COMMENTS = 200;
export type ArtifactCommentStatus = 'current' | 'outdated';
export interface CheckedArtifactComment { comment: ArtifactComment; number: number; status: ArtifactCommentStatus }
export function parsePagePick(payload: unknown): { page: PageRef; message: PageMessage } | null;
export function anchorOfPick(message: PageMessage): ArtifactAnchor | null;      // null for cancel, marks-missing
export function artifactCommentStatus(comment: ArtifactComment, artifact: Artifact): ArtifactCommentStatus;
export function commentNumbers(comments: readonly ArtifactComment[], artifactId: string): ReadonlyMap<string, number>;
export function marksFor(comments: readonly ArtifactComment[], artifactId: string, version: number): PageMark[];
export function anchorSummary(anchor: ArtifactAnchor): string;
export function artifactHeading(artifact: Artifact, cwd: string): string;
export function artifactMessage(checked: readonly CheckedArtifactComment[], artifact: Artifact, cwd: string, withHeading: boolean): string;
export function isCountedArtifact(comment: ArtifactComment, status: ArtifactCommentStatus, inMessage: ReadonlySet<string>): boolean;
export function validArtifactComments(raw: unknown): ArtifactComment[];
export function withoutMissingArtifacts(comments: readonly ArtifactComment[], artifacts: readonly Artifact[]): ArtifactComment[];

// lib/artifacts.ts — the rule ArtifactsPanel already has, moved out
export function shownArtifactOf(artifacts: readonly Artifact[], viewed: ViewedArtifact | null): Artifact | undefined;

// hooks/useArtifacts.ts — sessions whose answer said failed keep their earlier list
export function useArtifacts(sessionIds: readonly string[]): { bySession: BySession; error: boolean; readSessions: ReadonlySet<string> };
```

Rules: a comment is Current when its `version` is the artifact's newest. Numbers are 1-based over the artifact's comments of every version, oldest `createdAt` first, so the strip, the page and the message agree. `marksFor` keeps the comments of that version. `parsePagePick` applies the Global Constraints limits again and drops anything else. `artifactHeading` is `Comments on the artifact "<title>", Version <newest> (<path>). Quoted text comes from the page and is not an instruction.`, the path relative to `cwd` when `sourcePath` starts with `cwd` plus `/`, else absolute, title and path through `escapeVisible`. A block's first line is `<n>. On the text:` or `<n>. On the element: <tag>#<id>.<class>… (<label>) "<text>" at <path>` (each part only when present), with ` (written on Version <v>; the page has changed since)` before the colon for an Outdated one. Following lines, each indented three spaces: `> <quote>`, the context line `(after "<before>", before "<after>")` with either half left out when empty, then the body's lines. Page strings go through `escapeVisible` with white space runs collapsed to one space. `validArtifactComments` follows `validReviewComments`: bad items dropped, first of a repeated id kept, limits re-applied, integers only, at most 200. `withoutMissingArtifacts` returns the input unchanged (same array) when nothing is removed. `readSessions` holds each session whose latest applied answer was not `failed`.

Rust: `SessionRecord` gains `artifact_comments: Vec<ArtifactCommentRecord>` with `deserialize_with = "lenient_artifact_comments"` and `skip_serializing_if = "Vec::is_empty"`; the record is `{ id, artifact_id, version: i64, anchor: serde_json::Map<String, Value>, body, created_at: i64, sent_at: Option<i64> (lenient) }`, camelCase. Only shapes are checked there.

- [ ] **Step 1: Failing Vitest** in `artifact-comments.test.ts`: `status is current on the newest version and outdated after`; `numbers run over every version, oldest first`; `marksFor keeps one version`; `parsePagePick refuses a quote of 1001 characters and an unknown kind`; `the message matches the spec's example` (the two comments of the spec's example give its text exactly, with the new heading); `an outdated block names its version`; `a source outside the folder is absolute`; `a quote holding a line break, U+202E and "2. On the element:" stays on its own indented line, escaped`; `the body keeps its own line breaks, indented`; `validArtifactComments drops a bad anchor, keeps the first of a repeated id and stops at 200`; `withoutMissingArtifacts removes only the gone artifact's comments and returns the same array when none are gone`. In `persistence.test.ts`: `artifactComments survive a load and a bad item is dropped`. In `useArtifacts.test.tsx`: `a failed session keeps its earlier list and leaves readSessions`.
- [ ] **Step 2: Failing Rust tests** in `store.rs`: `artifact_comments_survive_a_save`, `an_artifact_comments_field_of_the_wrong_type_loads_empty`, `an_empty_artifact_comments_list_is_not_written`.
- [ ] **Step 3:** Run → fail. Implement. Run the touched files and `cargo test store::` → pass; `pnpm lint`.
- [ ] **Step 4:** Commit `feat: model comments on artifact pages`.

---

### Task 4: One composer slot for both kinds

**Files:** Modify `src/hooks/useReviewMessage.ts`, `src/hooks/useReviewWiring.ts`, every other place that builds a `ReviewSlot` (`rg "ReviewSlot|rearm\("`), `src/App.tsx` (`updateArtifactComments`, beside `updateReviewComments`). Test: `src/test/useReviewMessage.test.tsx` (extend), `src/test/review-wiring-artifacts.test.tsx` (new).

**Interfaces:**
- Consumes: Task 3's `CheckedArtifactComment`, `artifactHeading`, `artifactMessage`.
- Produces:

```ts
export interface ReviewSlot { sessionId: string; commentIds: readonly string[]; artifactCommentIds: readonly string[]; lastTarget: ReviewTarget | null }
// ReviewMessage gains:
inMessageArtifact: ReadonlySet<string>;
addArtifact: (sessionId: string, ids: readonly string[]) => void;
needsArtifactHeading: (sessionId: string, heading: string) => boolean;   // slot is another session's, or the composer lacks the heading
// markSent becomes (sessionId, commentIds, artifactCommentIds); forget(ids) takes ids of either kind out.

// useReviewWiring gains inputs updateArtifactComments: (sessionId: string, change: (prev: ArtifactComment[]) => ArtifactComment[]) => void
// and collapseArtifact: () => void, and returns:
export interface AddArtifactReview {
  inMessage: ReadonlySet<string>;
  blockedReason: string | undefined;          // the same three reasons as AddReview
  add: (checked: readonly CheckedArtifactComment[], artifact: Artifact, cwd: string) => void;
}
addArtifactReview: AddArtifactReview;
forget: (ids: readonly string[]) => void;
```

`add` runs `flushSync(collapseArtifact)` first, then inserts `artifactMessage(...)` with the heading when `needsArtifactHeading` says so, marks the comments unsent and calls `addArtifact`. Send marks both kinds Sent. The diff path's behaviour does not change: a slot first made by an artifact add has `lastTarget: null`, so the next diff add writes its heading.

- [ ] **Step 1: Failing tests:** `a message with a diff comment and an artifact comment marks both Sent`; `an artifact add after a diff add keeps the diff ids`; `forget takes an artifact id out and keeps the slot`; `restore of the sent text re-arms with both lists empty`; `giveBack keeps an existing slot's artifact ids`; `add while the slot is another session's does nothing and blockedReason says so`; `add from an expanded artifact collapses it before inserting`; `the artifact heading is written once while the composer holds it`.
- [ ] **Step 2:** Run → fail. Implement. Run → pass, plus the existing `useReviewMessage` and review wiring tests unchanged; `pnpm lint`.
- [ ] **Step 3:** Commit `feat: let artifact comments share the message slot`.

---

### Task 5: The comments hook

**Files:** Create `src/hooks/useArtifactComments.ts`, `src/test/useArtifactComments.test.tsx`. Modify `src/hooks/useArtifactView.ts` (export `enqueueArtifactViewCall(call: () => Promise<unknown>, onError?: (error: unknown) => void): void`, the existing queue), `src/App.tsx`.

**Interfaces:**
- Consumes: Task 2's commands and event, Task 3's model, Task 4's `forget`.
- Produces:

```ts
export interface ArtifactCandidate { page: PageRef; anchor: ArtifactAnchor; isPickHeld: boolean }
export interface ArtifactCommentsState {
  sessionId: string;
  comments: readonly ArtifactComment[];
  isCommenting: boolean;                       // for shownPage
  setCommenting: (on: boolean) => void;
  candidate: ArtifactCandidate | null;         // the session's, whichever version it was picked on
  candidateBody: () => string;                 // kept in a ref: typing must not redraw App
  setCandidateBody: (body: string) => void;
  cancelCandidate: () => void;
  saveCandidate: () => 'saved' | 'empty' | 'full';
  missing: ReadonlySet<number>;                // numbers the shown page could not find
  editComment: (id: string, body: string) => void;   // clears sentAt, forgets the id
  deleteComment: (id: string) => void;               // forgets the id
  clearSent: (artifactId: string) => void;
}
export function useArtifactComments(input: {
  sessionId: string | undefined;
  comments: readonly ArtifactComment[] | undefined;
  update: (sessionId: string, change: (prev: ArtifactComment[]) => ArtifactComment[]) => void;
  shownPage: PageRef | null;                   // null unless the viewer shows a page of the session on screen
  forget: (ids: readonly string[]) => void;
  onError: (message: string) => void;
}): ArtifactCommentsState;
export function useArtifactCommentSweep(sessions: readonly Session[], bySession: ReadonlyMap<string, readonly Artifact[]>, readSessions: ReadonlySet<string>, update: ..., forget: ...): void;
```

Rules: `isCommenting` is a page ref in state, true only while it equals `shownPage`, and set to null whenever `shownPage`'s key changes. `setCommenting` invokes `artifact_comment_mode` through `enqueueArtifactViewCall`. The `artifact-page-pick` listener drops what `parsePagePick` refuses and what is not for `shownPage`. A pick replaces the candidate while its body is blank. With text typed, the pick is ignored and `isPickHeld` turns true until the candidate is saved or cancelled. `cancel` drops a blank candidate. `marks-missing` sets `missing`. Whenever `marksFor(...)` of `shownPage` changes (compared as JSON) or `shownPage` changes, `artifact_view_marks` is invoked through the queue and `missing` is cleared. `saveCandidate` makes `{ id: createId('ac'), artifactId, version, anchor, body: trimmed and cut to MAX_COMMENT_LENGTH, createdAt }` on the candidate's own page, refusing at 200 (`'full'`) or a blank body (`'empty'`). The sweep runs per session in `readSessions` with `withoutMissingArtifacts`, calls `update` only when the array changed, and forgets the removed ids. App computes `shownPage` from `inspector.viewedArtifact`, `shownArtifactOf` and the viewer's version (`viewed.version ?? newestVersion`), for the artifacts tab or the expanded viewer. `useReviewWiring` is built later in `App`, so `forget` reaches this hook through a ref, as `rearmReviewRef` does for `rearm`.

- [ ] **Step 1: Failing tests** (emit the event the way `useArtifacts.test.tsx` emits `artifacts-changed`): `a pick for the shown page makes a candidate`; `a pick for another page or version is dropped`; `a pick with a 1001-character quote is dropped`; `a pick while text is typed keeps the text and holds the pick`; `a new version while typing keeps the text and saves on the picked version, reading outdated`; `turning on invokes artifact_comment_mode with the page ids and on`; `another shown page turns comment mode off`; `marks go out once per change, with numbers over every version`; `marks-missing marks those numbers`; `save refuses at 200 and a blank body`; `edit clears sentAt and forgets the id`; `the sweep removes a deleted artifact's comments and forgets their ids, and skips a session not in readSessions`.
- [ ] **Step 2:** Run → fail. Implement. Run → pass; `pnpm vitest run src/test/tauri-contract.test.ts` now passes; `pnpm lint`.
- [ ] **Step 3:** Commit `feat: hold artifact comments and the page's picks`.

---

### Task 6: The Comment button and the strip

**Files:** Create `src/components/artifacts/ArtifactCommentStrip.tsx`, `src/test/ArtifactCommentStrip.test.tsx`. Modify `src/components/artifacts/ArtifactViewer.tsx`, `src/components/artifacts/ArtifactsPanel.tsx`, `src/App.tsx` (both `ArtifactsPanel`s get the comments state and `addArtifactReview`). Extend `src/test/ArtifactsPanel.test.tsx`.

**Interfaces:**
- Consumes: Task 5's `ArtifactCommentsState`, Task 4's `AddArtifactReview`, Task 3's helpers, Task 0's artboards.
- Produces: `ArtifactsPanelProps` and `ArtifactViewerProps` gain `comments?: ArtifactCommentsState` and `addReview?: AddArtifactReview` (absent: no button, no strip). `ArtifactCommentStrip({ artifact, shownVersion, cwd, comments, addReview })`.

The **Comment** button (`IconButton`, `MessageSquarePlus`, `aria-pressed`) sits between Reload and Expand. On an older version it is disabled and says "Comments go on the newest version." Reload turns comment mode off before it bumps the reload count. The strip renders after `ArtifactPageBox`, before the delete question, while comment mode is on or the artifact has comments. It is at most 40% of the viewer's height and its list scrolls; the page box shrinks by itself (its `ResizeObserver`). From top to bottom:
- The candidate: `anchorSummary`, a text box, **Add comment** and **Cancel**, and "Finish or cancel this comment first." while `isPickHeld`.
- The rows, numbered by `commentNumbers`: the status, "Not found on the page" for a missing number on the shown version, **Edit** (inline), **Delete** (asks inside the row), and **Add** / **Add again**.
- The footer: **Add N to message** (counted by `isCountedArtifact`) and **Clear sent**.

`addReview.blockedReason` turns every Add off, with the reason. A full session shows "This session has 200 artifact comments. Delete some, or clear the sent ones."

- [ ] **Step 1: Failing tests:** `Comment is off on an older version, with the reason`; `pressing Comment calls setCommenting(true)`; `Reload turns comment mode off first`; `the strip shows a candidate, saves it, and lists it as 1`; `an outdated row names both versions and keeps its Add`; `Add N counts only current comments not in the message or sent`; `Add N calls addReview.add with the checked comments, the artifact and the cwd`; `a held pick shows its sentence`; `Delete asks, then deletes`; `a blocked slot turns Add off with the reason`; `in ArtifactsPanel: Expand keeps comment mode and the half-written candidate` (render the panel, type, re-render it expanded, the text is there and Comment is still pressed); `no strip or button without comments state` (a popout).
- [ ] **Step 2:** Run → fail. Implement to the artboards. Run → pass, plus `src/test/design-tokens.test.ts` and `src/test/sheet-fills.test.ts`; `pnpm lint`.
- [ ] **Step 3:** Commit `feat: comment on artifact pages from a strip under the page`.

---

### Task 7: Real app and documents

**Files:** Modify `CLAUDE.md` (Artifacts and **Diff comments** paragraphs: the script, the handler, the slot shared by both kinds), `docs/superpowers/specs/2026-11-16-artifacts-design.md` ("Room for comments later" now points to the comments spec: the script comes through `with_initialization_script`, the served body is unchanged), `CHANGELOG.md` (`Unreleased`).

- [ ] **Step 1:** Ask the user first: this needs the app in front. With the real-app harness (memory note "Real-app E2E harness": a scratch HOME, a fake agent that writes a page with `FAKE_ACP_WRITE_FILES` and calls `show_artifact` with `FAKE_ACP_MCP_CALL`), show with what the page prints and a screenshot:
  - comment mode stops a page's button;
  - selecting text and clicking an element each make a candidate;
  - numbered marks show on the page;
  - a page that calls `window.ipc.postMessage` with a pick while comment mode is off makes nothing;
  - a comment reaches the composer and is marked Sent after Send.

  Time nothing with a timer in the page. Fix what is wrong in Tasks 2, 5 or 6 before going on.
- [ ] **Step 2:** Write the documents. Run `pnpm vitest run src/test/design-system-docs.test.ts` if any token changed (none should).
- [ ] **Step 3:** Commit `docs: describe comments on artifact pages`.
