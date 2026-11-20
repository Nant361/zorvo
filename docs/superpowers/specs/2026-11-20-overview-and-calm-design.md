# Session overview and a calmer window: design

Date: 2026-11-20
Builds on: `2026-11-11-redesign-v2-design.md`, `2026-11-16-artifacts-design.md`, `2026-11-17-background-task-tabs-design.md`
Artboards: canvas "Zorvo redesign v2", section 14 (`OverviewMain`, `OverviewStates`, `ContextPanel`, `LinksAndPr`, `MotionSpec`) and section 15 (`CalmChat`, `SessionTitles`, `CalmHome`, `CalmHomePrivate`, `CalmSettings`). Local copies of the published versions are in `2026-11-20-overview-and-calm-artboards/`. The canvas decides look and copy, and this file decides behaviour.
Status: shipped, all ten parts, in the order below: links #251, motion and calmer chat #252, session titles #253, pull requests in the sidebar #254, Output #255, the overview card #260, the context panel #262, Settings rows #265, the new-session card #266.

## Goal

The user asked for ten changes after using other coding-agent apps that feel calm and simple. They are:

1. A right-click on a link opens it in the default browser.
2. The "N background tasks" chip leaves the top bar for a card.
3. Subagents go into the same card.
4. Artifacts is renamed Output.
5. A context panel opens from the composer's meter.
6. Every interaction gets smooth motion.
7. The hover background on replies is removed and the spacing grows.
8. The sidebar shows each session's PR status.
9. Output shows even when it is empty.
10. A review of the whole design.

Success:
- Running work, outputs and the PR of a session can be read without opening a tab.
- A link never replaces Zorvo's window.
- No reply flickers under the pointer.
- Every screen in section 15 has one level of borders per surface.

## Decisions taken with the user

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where the overview lives | A card **inside the chat sheet**, at its top right, sharing the top bar. It is not a separate panel |
| 2 | The tabbed inspector | Stays (Changes, Activity, Files, Output, Terminal, Tasks). The card links into it |
| 3 | Card sections | Environment (Changes, Files, branch), Running, Sources, Output, Pull request. Activity and Terminal are not in the card |
| 4 | Collapse | The card collapses to a pill ("3 running · +42 −11"). The state is per session, kept in memory for the run |
| 5 | Pull request section | Last in the card, shown only when the session has a PR. There is no "Create pull request" button |
| 6 | Chat pointer line | None. The chat shows no task rows and no line pointing to the card |
| 7 | Merged colour | The existing `status-merged` token. Zorvo has no coloured accent |
| 8 | Context breakdown | Qwen Code's real breakdown. Other agents get Zorvo's estimate, labelled as such |
| 9 | Claude adapter upstream change | Deferred |
| 10 | New session | One card: agent chips (each with its model), task, folder, branch, Private · TEE, Start |
| 11 | Session title | Rename, then the agent's title, then a tidied first line |

## Part 1: links

**What exists.** `ExternalLink` (`MarkdownRenderer.tsx:63`) opens `http`, `https` and `mailto` links through `open_external_url` (`windows.rs:161`) on a plain click. `installContextMenuGuard` (`lib/context-menu.ts`) blocks WebKit's menu in release builds, but `keepsNativeMenu` lets it through when the right-clicked node is selected. A right-click on macOS selects the word under the pointer first, so a link gets WebKit's menu, and its "Open Link" loads the page in Zorvo's own webview. Nothing guards the main window's navigation (only the artifact webview has one, `artifacts/view.rs:337`).

**Change.**
- `keepsNativeMenu` returns false for any target inside `a[href]`, whatever the selection.
- A `contextmenu` on such a link opens Zorvo's own menu (`LinkMenu`, artboard `LinksAndPr`) with three items: **Open in browser**, **Copy link**, and the address cut to one line.
  - It is a real menu: `role="menu"`, arrow keys, Escape, and focus goes back to the link.
  - Its look follows the menu motion token.
  - Copy writes the href with the clipboard API. Open calls `open_external_url`.
  - A link that `OPENABLE_URL` refuses gets only Copy link.
- The guard and the menu apply in dev builds too, but for links only. Inspect Element stays on the rest of a dev build.
- **Navigation guard.** The main window gets an `on_navigation` handler in `lib.rs`. It allows the app's own origin (the dev server, and `tauri://localhost` in a bundle) and refuses everything else. A refused `http`, `https` or `mailto` URL goes to `open_url` instead. A popout window gets the same handler. This is the safety net for any path the menu misses (a drag, a form, a future component).

**Tests.**
- `context-menu.test.ts`: a link with a selection does not keep the native menu.
- A component test for `LinkMenu`: it opens, the keyboard works, Copy and Open call the right functions, and a refused scheme gets Copy only.
- A Rust unit test for the navigation predicate: app origin allowed, `https://github.com` refused and handed to the opener, `file:` refused and not opened.

## Part 2: the overview card

**Where.** `ChatCanvas`'s sheet becomes a row: the chat column (flex 1) and the card (320 px, `align-self: start`, 16 px from the top and right). The card's height follows its content and scrolls inside itself when taller than the sheet. The top bar's panel button still toggles the tabbed inspector, which opens beside the sheet as today.

Below 900 px the card is hidden and its pill shows instead. Popouts get no card, since they have no inspector to link into.

**Sections and their sources.**

| Section | Rows | Source | A click |
|---|---|---|---|
| Environment | Changes (`+a −r`), Files (folder name), branch (`into <base>`) | `useInspector`'s stats, `session.cwd`, `worktree.branch` / git info | `inspector.show("changes")`, `show("files")`, the branch row opens Changes |
| Running | Subagents and shell commands of this session, newest first; finished ones fold under "N finished"; a failed one stays visible | `useBackgroundTasks` filtered to the session, plus subagent tools from `lib/task-view.ts` (`subagentTaskOf`) | The existing `openTask` (`inspector.show("tasks")` with the tab) |
| Sources | Files the user attached in this session | Attachments of the session's user messages | The file viewer for workspace files, the image preview for pasted images |
| Output | Artifact pages, then files the agent created | `useArtifacts` for the session, plus tools with a diff whose `isNewFile` is true and `completed` status | A page opens the Output tab on it; a file opens the file viewer |
| Pull request | Title, `#n`, state, checks, review | Part 5's PR data for the session's branch | `open_external_url(url)` |

Rules:
- Running and Sources are left out while they are empty. Output always shows, and when empty it reads "Nothing yet. Pages and files {Agent} makes in this session show here." Pull request shows only when the branch has one.
- Row counts are capped at 5 per section, with "Show N more".
- The card is built by a pure `overviewOf(session, inputs)` in `lib/session-overview.ts`, unit-tested, and drawn by `components/overview/OverviewCard.tsx`.
- **Collapse.** A ⌃ button sits beside the Environment heading. The collapsed pill shows the running count and the change counts. `useOverviewCollapse` keeps a `Set<sessionId>` in memory.

**What goes away.**
- `BackgroundTasksMenu` leaves the top bar.
- `TaskRow` leaves `MessageRow`, and `ShellTaskRows` leaves `tasksFooter`.
- A subagent's tool stays in the reply's tool list (`ToolsPart`) as a plain row, so what it returned can still be read in place.

Two consequences, accepted:
- The top bar's list was the only list of running tasks across sessions. The sidebar's **Working** filter now plays that role, and each row's status word already says Working.
- `useBackgroundTasks.open` from another session is no longer reachable from the top bar. It stays in use by the card.

**Data.** Nothing new is stored. The collapse set and the PR cache are memory only, and `STATE_VERSION` stays 2.

**Tests.**
- `session-overview.test.ts`: which sections are shown, the fold of finished tasks, the cap, and new files counted only at `completed`.
- An `App` test: the top bar has no background-task chip, and a card row opens the right inspector tab.

## Part 3: Output

- The inspector tab `artifacts` keeps its id and changes its label to **Output** (`Inspector.tsx:12`). The sidebar entry and the gallery heading change too.
- The agent tools `show_artifact` and `artifact_guide` keep their names, since agents already use them.
- `offeredTabs` always offers Output for a session on screen. Its empty state matches the card's sentence.
- The Output tab lists files the agent created below the pages, using the same source as the card. A file row opens the file viewer.
- Copy changes are in Part 10's list.

## Part 4: the context panel

**What exists.** `usage_update` folds into `ContextUsage { used, size, cost? }` (`useAcpSessions.ts:240`). `ContextMeter` shows a popover with four rows.

**Change.** A click on the meter opens the inspector on a new tab, `context`. It is offered only while the session has usage. It is drawn by `components/context/ContextPanel.tsx` (artboard `ContextPanel`) and holds the following.

- **Total.** Percent, `used / size`, and what is left. Without a size, only the tokens used, with "{Agent} does not say how big its window is."
- **Bar.** Used, free, and the autocompact buffer when reported. From 85% the used part turns `status-attention`, with the sentence "The window is nearly full. {Agent} may summarize older messages on its own."
- **Session cost**, when reported.
- **After each turn.** The `used` value recorded at each turn end, at most 24 bars. It lives in memory in `useAcpSessions` for the run.
- **What fills it.**
  - **Qwen Code.** A new command, `acp_context_usage(sessionId)`, sends the agent the request `qwen/status/session/context_usage` with `{ sessionId, detail: true }` (the wire name has no `_`; the ACP SDK inside Qwen Code passes it to `extMethod` as is). It uses `connection.request` with a 5 s timeout, only for the profile `qwen-code`. Rust validates the answer:
    - numbers that are finite and not negative
    - category keys from a fixed list (`systemPrompt`, `builtinTools`, `mcpTools`, `instructionFiles`, `memoryFiles`, `skills`, `messages`, `freeSpace`, `autocompactBuffer`)
    - item lists of at most 50 entries, names cut at 120 characters
    - `isEstimated`

    The panel labels the result "Estimated by Qwen Code" when `isEstimated` is set. The panel asks once when it opens, on its Refresh button, and at each turn end while open.
  - **Every other agent: Zorvo's estimate.**
    - **Messages:** the transcript's characters divided by 4.
    - **Instruction files:** a new `instruction_files(root)` command reads only fixed names. It checks `ensure_known_workspace` and reads at most 256 KiB each. It returns names and sizes, never contents. The names are `CLAUDE.md`, `AGENTS.md`, `QWEN.md` and `GEMINI.md` at the root, plus the same names in the user's agent folders (`~/.claude`, `~/.qwen`, `~/.gemini`, `~/.codex`) for the agent in use.
    - **Everything else:** the total minus those two.
    - Every value carries "~", the section is labelled "Estimated by Zorvo", and a note says the agent reports only the total.
- **Compact.** The button shows only when the session's available commands include `compact` or `compress` (`available_commands_update`). It sends that command as a prompt through the normal send path, and its hint names the command.

**Spike before building the Qwen path.** Run the request against Qwen Code 0.27.2 from a normal (not serve) ACP launch and record the answer as a fixture. The handler sits in the serve-status switch, so it may answer only under `QWEN_CODE_SERVE_ENV`. If it refuses, Qwen Code gets the estimate like the others, and this part says so.

**Spike result (2026-11-20).** It answers on a plain `--acp --experimental-skills` launch, with no serve env: 79 ms on the first call, 8 ms after. `extMethodInternal` gates only SSH workspaces. The answer is recorded in `src-tauri/tests/fixtures/qwen-context-usage.json` (paths and skill names replaced). What it changes:
- The numbers sit under `usage`, beside `v`, `sessionId`, `workspaceCwd`, `workspaceRoot` and a `formattedText` the panel does not use.
- `usage.breakdown` also holds `startupContext` (a category, added to the fixed list), `cachedTokens`, `thresholds` and `currentTier` (not categories; ignored).
- Items: tools and skills are `{ name, tokens }` (skills add `loaded`), instruction and memory files are `{ path, tokens }`, some with `absolutePath`. Rust keeps the name or `path` and drops `absolutePath`. The skills list had 398 entries: the 50 largest are kept, with the count of the rest.
- Before the first answer from the model `totalTokens` is 0 and `isEstimated` is true: the breakdown is the overhead before the conversation. The total the panel shows always comes from `usage_update`.
- An unknown session id answers `-32602`. Qwen Code has no `session/delete`; a session that took no prompt leaves nothing in `~/.qwen/projects`.
- **Where it opens.** The artboard draws a "‹ Overview" button, from when the panel was a drill-in of the overview. It opens as an inspector tab, as this part says, so the tab strip replaces that button.

**Tests.**
- `context-usage.test.ts`: the estimate arithmetic, the 85% threshold, the window-unknown case, the Compact button only with the command.
- A Rust test parses the recorded fixture and rejects bad shapes.
- `tauri-contract` picks up both new commands.

## Part 5: pull requests in the sidebar

**What exists.**
- `session_pull_request(path)` runs `gh pr list --head=<branch> --limit 1 --json number,title,url,state,isDraft,statusCheckRollup`, one session at a time.
- `repo_pull_requests(path)` lists the user's 31 PRs without checks.

**Change.**
- A new `workspace_pull_requests(path)` command runs, through `capture_gh`:

  ```
  gh pr list --state all --limit 100 --json number,title,url,state,isDraft,headRefName,statusCheckRollup
  ```

  It runs once per repository. It returns `PullRequestStatus` plus `headRefName`. A test pins the arguments.
- `useWorkspacePullRequests` keeps one result per repository in memory.
- It refreshes:
  - at start
  - on window focus, at most once every 2 minutes
  - at a turn end in a session of that repository, at most once a minute
- A session matches by `worktree.branch`, else the branch of its folder.
- The sidebar row shows the PR state icon and number in place of the time (`SessionRow`). The label is `aria-label="Pull request {n}, {state}"`, and a hover card shows the title and the checks (artboard `LinksAndPr`).
- Colours:
  - `status-running` for open
  - `fg-subtle` for draft and closed
  - `danger` for open with any failing check
  - `status-merged` for merged
- Without `gh`, without a sign-in, or without a github.com remote (`hasGithubRemote`), nothing is run and the rows show the time as today.
- The overview card and the top bar's `PullRequestChip` read the same cache. `usePullRequest`'s own `session_pull_request` call is then only a fallback for a branch outside the 100 newest.

**Tests.**
- A Rust test of the argument list and of parsing `headRefName`.
- `pull-request-chip.test.ts` for the state mapping, failing checks included.
- A sidebar test: a row with a PR and a row without one.

## Part 6: a calmer chat

These follow artboards `CalmChat` and `OverviewMain`.

- **Reply.** Remove `group-hover:bg-surface-2` and the `-mx-3 p-3` box from `MessageRow.tsx:275`. The action bar stays, shown on hover or focus through opacity under the `quick` token.
- **Spacing.**
  - `--container-chat` goes from 680 px to 720 px.
  - The chat scroller is `pt-9 px-8` and `space-y-8` (from `pt-7 px-6 space-y-[22px]`).
  - Paragraphs are 14/24.
- **The user's message.** `bg-chip`, no border, radius 14.
- **Permission card.** The `bg-attention-surface` fill becomes the card surface. A 1 px `attention-border` and the amber icon stay. The file list is plain rows with no inner box.
- **Elicitation fields.** Inputs use the card surface with a `border` line, not `bg-ground` wells.
- **Composer.** No `shadow-popover`. Chips are transparent and keep their chevron, and fill with `surface-hover` on hover.
- **Top bar.** The branch name and PR chip leave the title row, since the card shows both. The diff chip, the inspector toggle and ⋯ stay.

**Tests.**
- The existing `design-tokens` and `sheet-fills` tests stay green.
- A test pins that a reply has no hover background class.

## Part 7: session titles

These follow artboard `SessionTitles`. The order stays: Rename (`namedByUser`), then the agent's `session_info_update` title, then the first message.

`titleFromPrompt` (`lib/session-helpers.ts:30`) gains three steps before the cut:
1. A `github.com/<owner>/<repo>[/…]` URL becomes `owner/repo`. Any other URL becomes its host.
2. An absolute or home path with more than two parts becomes its last two parts.
3. A message that is only a slash command (`/word` plus optional arguments, nothing else) is not used. The title becomes "{Agent} in {folder}" until the agent sends one.

`MAX_TITLE_LENGTH` goes from 48 to 60, and the sidebar still cuts with an ellipsis. The full first line stays available as the row's `title` attribute. Only names Zorvo makes are touched. Saved names are not rewritten.

**Tests.** `session-helpers.test.ts` gets the four examples from the artboard plus an `http:` URL, a `mailto:`, a Windows-looking path, and a message of only spaces.

## Part 8: the new-session card

This follows artboard `CalmHome`.

**What exists.** `NewSessionHeading` with the `chipsSlot` (folder and branch), `AgentTiles` / `AgentMultiPicker` above the composer, model chips inside the composer, and the Private chip from `privateDraft`.

**Change.**
- The heading's own "New session" title goes, and the top bar's breadcrumb says it.
- The content block is centred vertically, 780 px wide.
- `AgentTiles` becomes a chip row at the top of the composer card (`AgentChipRow`).
  - Each chip toggles one agent, with `aria-pressed` and a check.
  - A picked agent's chip carries its model picker as a second button joined to it.
  - An agent that needs sign-in shows "Sign in" and opens the sign-in panel as the tile does today.
  - The **+** button opens the existing All agents picker.
- `DraftChips` (folder, branch) moves from the heading slot into the composer's bottom row, followed by the Private chip. The portal into `chipsSlot` is removed.
- The helper line under the card reads "Pick two or more agents to compare them. Each starts in its safest mode, in its own worktree."
- The "continue a session" list becomes plain rows with a hairline and no hover box.
- Turning **Private · TEE** on behaves as it does today:
  - only Qwen Code stays picked, the others are unticked
  - the model chip lists TEE models
  - the session limit chip appears
  - Start reads "Start private session"

  It is disabled with its reason as `title` while another agent is the only possible pick.

  **Artboard `CalmHomePrivate`** (canvas version 54, section 15; prop `state`: `on` or `disabled`) draws both, from `CalmHome`:
  - **On.** Qwen Code is the one picked chip, its model button holds the private model ("Qwen 3.8 27B"). Claude Code, Codex, Antigravity and **+** stay in the row but cannot be picked; their `title` reads "Private runs Qwen Code alone. Turn Private off to pick another agent." The bottom row is attach, folder, branch (no worktree), **Private · TEE** pressed, the session limit chip ("No session limit"), then **Start private session**. Under the card: "Qwen Code sends your prompts straight to NEAR AI. Each answer comes with a signature from the secure hardware, so you can check where it ran." and the credits left. No "continue a session" list, as today: a private draft offers no import.
  - **Disabled.** Claude Code is the only agent that can start: the Private chip is muted and `aria-disabled`, and its reason ("Private mode works with Qwen Code for now. Claude Code sends your code to Anthropic.") shows under the row and as its `title`. Start reads **Start session**; the helper line and the continue list are as in `CalmHome`.

**Tests.** The existing draft, compare and private-draft tests move their queries from tiles to chips. New cases: the model button of a picked chip, and the Private chip in the bottom row.

## Part 9: Settings → Agents rows

This follows artboard `CalmSettings`.

- `AgentCatalogRow`: the `SignInChip` pill becomes a dot and a word ("Ready", "Needs sign-in", "Not checked").
- The update button reads **Update**, and the version line under the name says "update {v} ready".
- Each row has one primary action. Check sign-in, Remove and the rest go into ⋯.
- `AgentSignIn` drops its inner box. Methods are rows inside the row, with a hairline between them. A key method's row has **Check again** as a text button.
- The session warning moves to the ⋯ item's description.

**Tests.** The `settings-agents` tests' queries follow the new names. The ⋯ menu holds Check sign-in.

## Part 10: motion

**Tokens** in `globals.css` `@theme`, mirrored in `docs/design-system/tokens.json`:

| Token | Value | Use |
|---|---|---|
| `--duration-quick` | 120 ms, `ease-out` | Hover, press, colour changes |
| `--duration-menu` | 180 ms, `--ease-soft` | Menus, popovers, tooltips: fade plus scale 0.97 to 1 from the trigger's side |
| `--duration-panel` | 240 ms, `--ease-soft` | The inspector opening, the card collapsing, the card's drill-in (16 px slide plus fade) |
| `--duration-appear` | 160 ms, `ease-out` | A new message or card fades in once. Streamed text is not animated |
| `--ease-soft` | `cubic-bezier(.2,.8,.2,1)` | |

**Rules.**
- One `@media (prefers-reduced-motion: reduce)` block sets every transition and animation to 1 ms and drops transforms.
- Nothing loops except a spinner of real running work.
- Diffs, terminals, the chat's follow-the-bottom scroll and changing numbers are not animated.
- Popover and Menu primitives in `components/ui/` take the menu token, so every menu gets it at once.
- The 37 `transition-colors` uses take `duration-quick` through one utility.
- A unmount after an exit animation uses `onTransitionEnd`, with a timeout fallback, so nothing stays mounted when the event is lost.

**Tests.**
- `design-system-docs` covers the new tokens.
- A test checks that the reduced-motion block exists.
- A test checks that no component uses `animate-` other than `motion-safe:animate-spin` and `animate-pulse` on a status.

## Copy

| Where | Text |
|---|---|
| Card headings | Environment, Running, Finished, Sources, Output, Pull request |
| Output empty | Nothing yet. Pages and files {Agent} makes in this session show here. |
| Collapsed pill | {n} running · +{a} −{r} (parts left out when zero) |
| Link menu | Open in browser, Copy link |
| Context | Context, {p}%, {used} / {size} tokens, {left} left before the window is full, What fills it, Estimated by {Agent} / Estimated by Zorvo, After each turn, Refresh, Compact context / Compress context |
| Context notes | {Agent} reports only the total. Zorvo counts the chat and the instruction files itself; everything else is system prompt, tools, skills and memory together. / {Agent} does not say how big its window is, so Zorvo cannot show how much is left. / The window is nearly full. {Agent} may summarize older messages on its own. |
| Inspector tab | Output (was Artifacts) |
| New session helper | Pick two or more agents to compare them. Each starts in its safest mode, in its own worktree. |

## Order of work

Each step is one PR, and none needs a later one:

1. **Links** (Part 1). This fixes a bug, so it ships first.
2. **Motion tokens and the calmer chat** (Parts 10 and 6). They are visible at once and change no behaviour.
3. **Session titles** (Part 7).
4. **Pull requests in the sidebar** (Part 5). The card later reuses its cache.
5. **Output rename and always offered** (Part 3).
6. **The overview card**, with the top-bar chip and the chat task rows removed (Part 2).
7. **The context panel** (Part 4), after its spike.
8. **The new-session card** (Part 8), after the Private-on artboard.
9. **Settings rows** (Part 9).

## Not in this version

- A Claude Code breakdown of context through its adapter (deferred upstream change).
- A cross-session running list anywhere but the sidebar's Working filter.
- Persisting the card's collapse across restarts.
- A "Create pull request" action.
- Rewriting names already saved.
- Animating streamed text.
- Enterprise GitHub hosts.
