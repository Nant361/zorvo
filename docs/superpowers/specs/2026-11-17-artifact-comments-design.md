# Artifact comments: feedback on a page, sent to the agent

Date: 2026-11-17. Status: design, waiting for review.

Builds on `2026-11-16-artifacts-design.md` (the artifact page, its child
webview, its store). The code needs that work: it branches from
`feat/artifacts` or waits for it to merge.

## Goal

The user marks a part of an artifact page, a piece of text or an element,
writes what should change, and sends it to the agent through the composer.
It works like Diff comments: a comment is written in Zorvo, added to the
message, and leaves only when the user presses Send.

## Decisions made with the user

- **Feedback for the agent**, not notes kept on the page. A comment's job ends
  once the agent has made a newer version.
- **Text and elements.** The user selects text as usual, or turns on comment
  mode and clicks an element (a chart, a button, a card).
- **Written in Zorvo, under the page.** The page only shows numbered marks.
  What the user types never enters the page's process.
- **A list of its own** (`Session.artifactComments`) that shares only the
  composer slot with Diff comments, so one message can hold both kinds and
  the diff comment code stays as it is.

## Out of scope

Comments that stay on the page across versions, comments on an older version,
replies or threads, comments in a popout, comments written by the agent,
comments in an exported file, typed artifacts and the design canvas (their
own spec, which will reuse this one).

## 1. Bridge between the page and Zorvo

### Zorvo's script in the page

The child webview gets one script of Zorvo's own through wry's
`with_initialization_script`. It runs before the page's scripts and is not
subject to the page's CSP, so the served body stays the stored bytes and
Export is unchanged. This replaces the base spec's plan of adding the script
to the served body; the base spec's note is updated to say so.

The script does three things: it reports a pick, it draws marks, and it runs
comment mode. It holds no comment text, ever.

### From the page to Zorvo: picks

The child webview gets a message handler (`with_ipc_handler`) that carries
data only. Messages are JSON, at most 16 KiB, of four kinds:

| Kind | Fields |
| --- | --- |
| `pick-text` | `quote` (at most 1000 characters), `before` and `after` (at most 60 each) |
| `pick-element` | `tag`, `elementId`, `classes` (at most 5), `label` (`aria-label` or `role`), `text` (at most 200), `path` (CSS path with `nth-of-type`, at most 12 levels) |
| `cancel` | none |
| `marks-missing` | `numbers` (at most 200 positive integers), the marks the script could not find |

Rust checks the shape (a known kind, every string within its limit, no other
fields) and accepts a message only from the page on screen (the view's
generation number); the three pick kinds only while comment mode is on, and
`marks-missing` only after Zorvo has sent marks to that page. More than 5 messages in a
second are dropped. An accepted pick is emitted to the main webview as
`artifact-page-pick` (`{ sessionId, artifactId, version, anchor }`), and the
webview drops one that does not match the artifact and version it shows.

**The page can call this handler too.** `window.ipc` is visible to every
script in the page, so the agent's page can send a pick of its own. A pick
therefore only fills a candidate in Zorvo's panel, shown through
`escapeVisible`. A comment exists only once the user writes its text, and it
leaves only on Send. The worst a hostile page can do is offer a false
candidate, in plain sight.

### From Zorvo to the page: marks

`artifact_view_marks(marks)` runs `evaluate_script` with one fixed call,
`__zorvoMarks(<JSON>)`, holding each comment's number and anchor for the
version shown. The script finds each anchor again (the element by its path,
the text by searching for `before` + `quote` + `after`, then `quote` alone)
and draws an outline and a numbered badge in an overlay of its own. A mark it
cannot find is not drawn, and it reports which numbers it could not find
(`marks-missing`) so the panel can say so. A page could send a false
`marks-missing`; the worst it does is label a comment "Not found on the page". No comment
text is sent to the page, only numbers and anchors.

### Comment mode

`artifact_comment_mode(on)` turns it on or off in Rust and in the script.
While it is on, the script catches clicks in the capture phase with
`preventDefault`, so the page's buttons and links do nothing, outlines the
element under the pointer, and reports a click as `pick-element`. A text
selection that ends with the mouse up is reported as `pick-text`, in comment
mode only. A page that sets out to can break comment mode, but it cannot reach
Zorvo, which is the base spec's boundary.

Reload and a new version make a new generation; comment mode starts off
again, and the marks are sent again once the page has loaded.

## 2. Screens

Copy is sentence case. No keyboard shortcuts. Look follows the v2 surfaces,
`components/ui/` primitives, and new artboards on the canvas "Zorvo redesign
v2" (a section after Artifacts, built from those artboards), which decide look
and wording; this spec decides behaviour.

### Comment button

The viewer's header gets **Comment** between Reload and Expand. It turns
comment mode on and off, and is pressed while on. It works on the newest
version only; on an older one it is disabled with the reason "Comments go on
the newest version." An older version still shows its own comments and marks.

### The strip under the page

A strip under the page's box shows while comment mode is on or the artifact
has comments. The page's box gets shorter by the strip's height (the child's
bounds follow). The strip is at most 40% of the viewer's height, and its list
scrolls. From top to bottom:

1. **Candidate.** After a pick: the quote, or a line that names the element
   ("Button 'Export CSV' in section #pricing"), a text box, **Add comment**
   and **Cancel**. A new pick replaces a candidate with an empty box. When the
   box holds text, a new pick does not replace it, and the strip says so.
2. **Comments on this artifact,** oldest first. Each row: the number (the same
   as on the page), the anchor's summary, the text, the status, **Edit**,
   **Delete** and **Add**.
3. **Footer:** **Add N to message** and **Clear sent**.

Statuses:

| Status | When |
| --- | --- |
| Current | Written on the newest version |
| Outdated | A newer version exists: "Written on Version 2; the page is now Version 3." It keeps its own Add, as an Outdated diff comment does |
| In message | In the composer's slot for this session |
| Sent | Send was pressed with it in the message; it keeps **Add again** |

"Not found on the page" is shown beside the status of a comment whose mark the
script could not find; the comment is kept.

Add N counts Current comments that are neither In message nor Sent.

### Expand and the native layer

The strip goes with the page when it is expanded. Add from an expanded viewer
shrinks it, so the composer shows, as DiffView does. The strip lies under the
page's box, not over it, so it never hides the page. Its menus and the Delete
question open inside the strip; one that would overlap the page's box hides
the page as the base spec says.

### Owner

A comment belongs to the session of its artifact. While the composer's slot
belongs to another session, Add is off with the reason Diff comments give
(`isHeldFor`, `reviewOwner`), and the same composer notes apply.

## 3. Data and the message

### Type

In `src/types/index.ts`:

```ts
type ArtifactAnchor =
  | { kind: 'text'; quote: string; before: string; after: string }
  | { kind: 'element'; tag: string; elementId?: string; classes: string[];
      label?: string; text: string; path: string };

interface ArtifactComment {
  id: string;
  artifactId: string;
  /** The version it was written on. A comment never moves to another. */
  version: number;
  anchor: ArtifactAnchor;
  body: string;
  createdAt: number;
  /** Send was pressed with it in the message, not that the agent acted. */
  sentAt?: number;
}

// Session.artifactComments?: ArtifactComment[]
```

Kept with a lenient per-item reader in `lib/persistence.ts` and `store.rs`,
as `reviewComments` is; `STATE_VERSION` stays 2. A session holds at most 200
artifact comments, and a comment's text follows `MAX_COMMENT_LENGTH`.

### The message

`lib/artifact-comments.ts` words it:

```
Comments on the artifact "Pricing report", Version 3 (reports/pricing.html):

1. On the text:
   > Annual plan saves 20%
   (after "…monthly price. ", before " Cancel any…")
   Make this a badge, not a sentence.

2. On the element: button#export.btn "Export CSV" at main > section:nth-of-type(2) > button
   Move it next to the table title.
```

- The source path is relative to the session's folder, or absolute outside
  it, so the agent knows which file to change.
- Quotes, context and element lines go through `escapeVisible`; the text is
  verbatim, as in Diff comments.
- An Outdated comment's block adds "written on Version 2; the page has
  changed since".
- A message may hold diff blocks and artifact blocks, each under its own
  heading.

### The composer slot

`useReviewMessage`'s slot becomes `{ sessionId, commentIds,
artifactCommentIds, lastTarget }`. Lifting, `restore`, `giveBack`, re-arming
and `lastSends` keep their rules and apply to text that holds either kind.
Send marks both kinds Sent.

### Lifecycle

- Deleting an artifact removes its comments. Comments whose artifact is
  missing from a successful `artifact_list` of their session are removed too.
- Deleting a session removes its comments with it. Rewinding leaves them.
- A version pruned by the base spec's limits leaves its comments Outdated,
  with no marks to draw.
- Comment text never goes to the page, a log, or an exported file.

## 4. Code layout

- Rust: `src-tauri/src/artifacts/` gains `page_script.rs` (the script's text
  and its tests), `picks.rs` (checking a message, the rate limit) and two
  commands in `commands.rs` (`artifact_comment_mode`, `artifact_view_marks`);
  `view.rs` adds the script and the handler to the child.
- Frontend: `lib/artifact-comments.ts` (status, summary, the message, the
  sweep), `hooks/useArtifactComments.ts` (the session's comments, the
  candidate, the picks), `components/artifacts/ArtifactCommentStrip.tsx`, the
  Comment button in `ArtifactViewer`, the wider slot in
  `hooks/useReviewMessage.ts`.

## 5. Testing

- **Rust unit:** a pick of an unknown kind, over 16 KiB, with a string over
  its limit or an extra field, while comment mode is off, from an older
  generation, or beyond 5 in a second is refused. A test pins the script's
  text and the `__zorvoMarks` name, so any change to them is visible.
- **Vitest:** `lib/artifact-comments.ts` (Current, Outdated, Not found; the
  message; escapes; the sweep); the shared slot (a message with both kinds;
  `restore` and `giveBack` keep the right owner); the strip (a pick does not
  replace typed text, Comment is off on an older version, Add from Expand
  shrinks); the lenient readers. The Tauri contract test covers
  `artifact-page-pick` and the two commands.
- **Real app,** with the existing harness and the build in front: comment
  mode stops a page's button, selecting text and clicking an element make a
  candidate, the numbers show on the page, a page that calls
  `window.ipc.postMessage` itself while comment mode is off makes nothing,
  and a comment reaches the composer. Nothing in it is timed by a timer in a
  page.

## 6. Order of work

| # | Step | Done when |
| --- | --- | --- |
| 0 | Artboards | Candidate, list with statuses, comment mode on the page, Outdated, on the v2 canvas |
| 1 | Backend | Script, handler and its checks, comment mode, marks |
| 2 | Data and message | Type, persistence, `lib/artifact-comments.ts`, the wider slot |
| 3 | Screens | Comment button, strip, marks on the page, Expand |
| 4 | Real app and documents | The real-app checks pass; documents below updated |

## 7. Documents that change

CLAUDE.md (Artifacts and Diff comments), the base spec's "Room for comments
later" note, `CHANGELOG.md` under `Unreleased`.
