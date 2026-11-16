# Background Task Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A subagent or shell command an agent started opens as a tab in the inspector and can be followed there, while the chat shows one row per subagent.

**Architecture:** The reducer in `lib/acp-events.ts` learns which updates belong to a subagent (from `_meta`) and files them under the parent tool call instead of the reply. Everything else is derived from the transcript by pure helpers: the chat row, the tab's content, the status word. Open tabs are memory-only state in one hook; the inspector gains a `tasks` tab that only exists while a task tab is open. No new Tauri command or event.

**Tech Stack:** React 19, TypeScript, Tailwind 4 tokens, Vitest + Testing Library; one flag on the Node fake ACP agent and one Rust integration test.

**Spec:** `docs/superpowers/specs/2026-11-17-background-task-tabs-design.md`. Artboards: `docs/superpowers/specs/2026-11-17-background-task-tabs-artboards/` (`TasksMain`, `TasksInspector`, `TasksChatRows`). Read both; the artboards decide look and copy.

## Global Constraints

- Branch `feat/background-task-tabs`, in its own worktree cut from `main`. Conventional Commits. One line under `Unreleased` in `CHANGELOG.md`.
- Only design tokens (`bg-sheet`, `bg-surface-2`, `text-fg-muted`, `border-border-strong`, `text-status-running`, `text-status-attention`, `text-danger`); no raw colors; `Button` / `IconButton` / `Chip` from `src/components/ui/` first; `focus-ring` on every focusable control.
- Copy: sentence case, name the agent, exact strings from the spec and artboards. No keyboard shortcuts.
- Immutable updates; functions under 50 lines; source files under 800 lines (`acp-events.ts` is 528: new logic goes in a new file).
- `STATE_VERSION` stays 2. Transcripts are opaque JSON in Rust (`store.rs` `load_transcript` returns `Vec<serde_json::Value>`), so no Rust type changes; the spec's mention of `store.rs` does not apply.
- Run only targeted tests locally: `pnpm vitest run <file>` and `pnpm lint`. The full suite runs in the pre-push hook and CI. Cargo only for Task 8.
- `MAX_SUBAGENT_TEXT = 20_000`.
- A subagent tab never has Stop. A finished shell command has no row and no tab.

## Review Focus

1. A child update whose parent tool call is not in the open reply (announced late, or from an earlier turn): it must be folded as today, nothing dropped. Test in Task 1.
2. A subagent that writes more than 20,000 characters: the text is cut once, with the note, and later chunks are ignored. Test in Task 1.
3. A transcript on disk with a malformed `steps` or `parentId` (wrong type, a `toolIds` entry naming no tool): the bad field is dropped and the tool shows as a plain tool. Test in Task 2.
4. A permission request from a subagent while its row is on screen: the row reads "Needs you", not "Working". Test in Task 3.
5. A rewind or a deleted session removes the message whose task tab is open: the tab closes and the `tasks` segment goes when it was the last. Test in Task 5.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/acp-subagents.ts` (new) | `parentToolIdOf`, `agentTypeOf`, filing a child tool / text / thought under its parent |
| `src/lib/acp-events.ts` | calls the above from `addToolCall`, the two chunk cases; nothing else |
| `src/types/index.ts` | `ToolExecution.parentId`, `agentType`, `steps`, `thinking`, `isTextCut` |
| `src/lib/persistence.ts` | lenient read of the new fields in `normalizeTranscript` |
| `src/lib/task-view.ts` (new) | pure: which tools are tasks, their row facts, status word, the tab's parts |
| `src/lib/background-tasks.ts` | exports `isSubagent`; shell task facts with the matched tool id |
| `src/components/chat/TaskRow.tsx` (new) | the chat row |
| `src/components/chat/ToolCallList.tsx`, `ToolsPart.tsx` | leave out child tools, draw task rows |
| `src/hooks/useTaskTabs.ts` (new) | open task tabs per session, memory only |
| `src/lib/inspector.ts`, `src/components/inspector/Inspector.tsx`, `src/hooks/useInspector.ts` | the `tasks` tab |
| `src/components/tasks/TaskTabs.tsx`, `SubagentTaskPanel.tsx`, `ShellTaskPanel.tsx` (new) | strip and the two panels |
| `src/components/topbar/BackgroundTasksMenu.tsx`, `src/hooks/useBackgroundTasks.ts` | Open goes to the tab |
| `src-tauri/tests/fixtures/fake_acp_agent.mjs`, `src-tauri/tests/it/acp_subagent_test.rs` (new, with its `mod` line) | `FAKE_ACP_SUBAGENT` |

---

### Task 1: File a subagent's updates under its parent

**Files:**
- Create: `src/lib/acp-subagents.ts`, `src/test/acp-subagents.test.ts`, `src/test/fixtures/acp-subagent-qwen.json`, `src/test/fixtures/acp-subagent-claude.json`
- Modify: `src/types/index.ts` (`ToolExecution`), `src/lib/acp-events.ts` (`addToolCall`, `agent_message_chunk`, `agent_thought_chunk` cases)

**Interfaces:**
- Produces, in `types`: on `ToolExecution`, `parentId?: string`, `agentType?: string`, `steps?: ChatMessagePart[]`, `thinking?: string`, `isTextCut?: boolean`.
- Produces, in `acp-subagents.ts`:
  - `export const MAX_SUBAGENT_TEXT = 20_000`
  - `parentToolIdOf(meta: unknown): string | undefined` — `meta.claudeCode.parentToolUseId`, else `meta.parentToolCallId`; only a non-empty string counts.
  - `agentTypeOf(meta: unknown): string | undefined` — `meta.subagentType`.
  - `withChildTool(reply: ChatMessage, parentId: string, tool: ToolExecution, agentType?: string): ChatMessage | undefined`
  - `withChildText(reply: ChatMessage, parentId: string, chunk: string): ChatMessage | undefined`
  - `withChildThought(reply: ChatMessage, parentId: string, chunk: string): ChatMessage | undefined`
  - Each returns `undefined` when `reply.tools` has no tool with id `parentId`; the caller then folds the update as before.

Fixtures: the Qwen one is the spike's recording trimmed to one subagent (parent `tool_call` named `agent`, a child thought, two child `tool_call`s with updates, child text, parent completed), each entry a raw `session/update` payload's `update` object. The Claude one is the same sequence with `_meta: { claudeCode: { toolName, parentToolUseId } }`; mark it in a top comment field `"_note": "hand-written from the adapter source; replace with a recording"`.

- [ ] **Step 1: Write the failing tests** in `src/test/acp-subagents.test.ts`. Fold each fixture with `applyAcpUpdate` from an empty transcript and a fixed `ctx`, then assert:

```ts
test.each(['qwen', 'claude'])('files a %s subagent under its parent', (name) => {
  const reply = fold(fixture(name)).at(-1)!;
  const parent = reply.tools!.find((t) => t.steps)!;
  const children = reply.tools!.filter((t) => t.parentId === parent.id);
  expect(children).toHaveLength(2);
  expect(partsOf(reply).flatMap((p) => (p.kind === 'tools' ? p.toolIds : []))).toEqual([parent.id]);
  expect(reply.content).toBe('');                       // child text is not the reply's
  expect(parent.steps!.map((p) => p.kind)).toEqual(['tools', 'text']);
  expect(parent.thinking).toMatch(/hypothesis/i);
  expect(reply.thinking ?? '').toBe('');
});
test('qwen reports the subagent type on the parent', …  expect(parent.agentType).toBe('general-purpose'));
test('a child whose parent is not in the open reply is folded as before', …
  // drop the parent tool_call from the fixture: both tools are in parts, text is in content, no tool has steps
test('a replay gives the same messages', … applyReplayUpdate over the fixture equals applyAcpUpdate's tools and steps
test('child text is cut at MAX_SUBAGENT_TEXT', …
  // two chunks of 15,000 chars: steps text length is 20,000, parent.isTextCut is true, a third chunk changes nothing
test('parentToolIdOf ignores wrong types', … '' , 7, null, {} → undefined
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/acp-subagents.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `acp-subagents.ts`.** A child tool is appended to `reply.tools` with `parentId`, and its id to the parent's last `tools` step (or a new one), never to `reply.parts`; `agentType` is set on the parent when given and not yet set. Child text appends to the parent's last `text` step or adds one.
- [ ] **Step 4: Call it from `acp-events.ts`.** In `addToolCall` and the two chunk cases: read `parentToolIdOf(update._meta)`; when set and an open reply exists, try the `withChild…` helper inside `withOpenReply` and fall back to today's change when it returns `undefined`. `updateToolCall` needs no change (it finds tools by id).
- [ ] **Step 5: Run** the new file and `pnpm vitest run src/test/acp-events.test.ts`. Expected: PASS, the existing file unchanged.
- [ ] **Step 6: Commit** `feat: file a subagent's updates under its tool call`.

### Task 2: Keep the new fields across a save and a load

**Files:**
- Modify: `src/lib/persistence.ts` (`normalizeTranscript`, near line 410)
- Test: `src/test/persistence.test.ts`

**Interfaces:**
- Consumes: Task 1's fields.
- Produces: a loaded tool has `parentId` only when it is a string naming another tool of the same message; `steps` only when every part passes `isMessagePart` and every `toolIds` entry names a tool of the same message whose `parentId` is this tool; `agentType` and `thinking` only when strings; `isTextCut` only when `true`. A field that fails is removed, and a tool that loses `parentId` is appended to the message's `parts` so it shows.

- [ ] **Step 1: Write the failing tests**: `keeps a subagent's steps across a load` (round trip of Task 1's folded Qwen fixture is deep-equal); `drops a malformed steps list and shows its tools` (`steps: [{ kind: 'tools', toolIds: ['nope'] }]`, `parentId: 7`); `loads a transcript saved before subagent steps unchanged`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/persistence.test.ts -t "subagent"`. Expected: FAIL.
- [ ] **Step 3: Implement** in `normalizeTranscript`, as a helper `normalizeSubagentFields(message)`.
- [ ] **Step 4: Run** the whole file. Expected: PASS.
- [ ] **Step 5: Commit** `feat: keep subagent steps in saved transcripts`.

### Task 3: The task view (pure)

**Files:**
- Create: `src/lib/task-view.ts`, `src/test/task-view.test.ts`
- Modify: `src/lib/background-tasks.ts` (export `isSubagent`)

**Interfaces:**
- Produces:

```ts
export type TaskStatus = 'Working' | 'Needs you' | 'Done' | 'Failed' | 'Did not finish';
export interface SubagentTask {
  toolId: string; title: string; agentType?: string;
  stepCount: number;            // child tools
  status: TaskStatus; startedAt?: number;
  hasSteps: boolean;            // false: the agent marks nothing, no tab
  lastText?: string;            // the last text step, for "What it told {Agent}"
}
export function shownTools(tools: readonly ToolExecution[]): ToolExecution[];           // without tools that have parentId
export function isTaskTool(tool: ToolExecution): boolean;                                // has steps, or isSubagent(tool)
export function subagentTaskOf(tool: ToolExecution, message: ChatMessage, on: { isTurnOver: boolean }): SubagentTask;
export function stepsOf(tool: ToolExecution, message: ChatMessage): { parts: ChatMessagePart[]; tools: ToolExecution[] };
export function secondLine(task: SubagentTask, agentName: string): string;
```

- Status rules: tool `failed` → Failed; `completed` → Done; `running` and `isTurnOver` → Did not finish; `running` and the message's pending `actionCard` names a tool call whose `parentId` is this tool → Needs you; else Working.
- `secondLine`: `"{agentType} · N steps"`, `"N steps"` without a type, `"1 step"` for one, and `"{agentName} doesn't report this subagent's steps"` when `hasSteps` is false.

- [ ] **Step 1: Write the failing tests**, one per status rule (including `reads Needs you while its child waits for a permission`), `shownTools leaves out child tools`, `a subagent with no steps has no tab` (a tool named `Task` with no `steps` → `hasSteps` false), the four `secondLine` strings, `stepsOf returns the child tools in order`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/task-view.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check how a pending card names its tool call (`ActionCard` in `types`, set in `applyPermissionRequest`) and use that field.
- [ ] **Step 4: Run.** Expected: PASS; also `pnpm vitest run src/test/background-tasks.test.ts`.
- [ ] **Step 5: Commit** `feat: derive task rows from the transcript`.

### Task 4: The row in the chat

**Files:**
- Create: `src/components/chat/TaskRow.tsx`, `src/test/task-row.test.tsx`
- Modify: `src/components/chat/ToolCallList.tsx`, `src/components/chat/ToolsPart.tsx`

**Interfaces:**
- Consumes: `shownTools`, `isTaskTool`, `subagentTaskOf`, `secondLine`.
- Produces: `TaskRow({ task, secondLine, elapsed, isOpen, onOpen }: { task: SubagentTask; secondLine: string; elapsed?: string; isOpen: boolean; onOpen?: () => void })`. With `onOpen` and `task.hasSteps` it is one `<button>` with `aria-pressed={isOpen}` and the accessible name `"Open {title}. {status}, {N} steps."`; otherwise a plain `div` with no chevron.
- `ToolCallList` gains `onOpenTask?: (toolId: string) => void` and `openTaskId?: string`, passed down from `ToolsPart` (and from wherever `ToolsPart` gets its props; a popout passes neither, so its rows are not buttons).

Look: the artboard `TasksChatRows`: `bg-surface-2`, `border`, `rounded-lg`, the 28px icon tile, title in `text-fg`, second line `text-caption text-fg-subtle`, status word coloured by state with the elapsed time in mono under it, chevron last; `border-border-strong` while its tab is open. Elapsed uses `formatElapsed` from `lib/background-tasks.ts` and only shows while Working or Needs you.

- [ ] **Step 1: Write the failing tests**: each status renders its word; `a row with steps is a button that opens its task`; `a row without steps is not a button and says the agent doesn't report steps`; in `tool-call-list.test.tsx`, `leaves a subagent's own tools out of the list` and `draws a subagent as a task row`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/task-row.test.tsx src/test/tool-call-list.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `ToolCallList`, map over `shownTools(tools)`; a tool for which `isTaskTool` is true renders `TaskRow`, the rest as today. The summary line in `ToolsPart` must count only shown tools.
- [ ] **Step 4: Run** those files plus `pnpm vitest run src/test/tool-call-list-diff-cost.test.tsx`. Expected: PASS, the cost test unchanged.
- [ ] **Step 5: Commit** `feat: show a subagent as one row in the chat`.

### Task 5: Open task tabs and the `tasks` inspector tab

**Files:**
- Create: `src/hooks/useTaskTabs.ts`, `src/test/use-task-tabs.test.tsx`
- Modify: `src/lib/inspector.ts`, `src/hooks/useInspector.ts`, `src/test/inspector.test.tsx` (or the file that tests `offeredTabs`)

**Interfaces:**
- Produces:

```ts
export type TaskTab = { kind: 'subagent'; toolId: string } | { kind: 'shell'; taskId: string };  // taskId: a BackgroundTask id
export interface TaskTabs {
  tabs: readonly TaskTab[];          // of the session on screen
  selected: TaskTab | null;
  open: (sessionId: string, tab: TaskTab) => void;   // adds if new, selects it
  select: (tab: TaskTab) => void;
  close: (tab: TaskTab) => void;     // selects the neighbour
}
export function useTaskTabs(args: { sessionId: string | null; exists: (tab: TaskTab) => boolean }): TaskTabs;
```

- `InspectorTab` gains `"tasks"`; `offeredTabs` takes `hasTaskTabs?: boolean` and puts `"tasks"` before `"terminal"` when true; `isWideTab` is true for `"tasks"`.
- A tab for which `exists` is false is dropped in the render that notices it. State is a `Map<sessionId, …>` in memory, never persisted.

- [ ] **Step 1: Write the failing tests**: `opening the same task twice keeps one tab and selects it`; `closing the selected tab selects its neighbour`; `tabs are kept per session`; `a tab whose task is gone closes`; `closing the last tab leaves no tabs`; in the inspector tests, `offers Tasks before Terminal only while a task tab is open` and `the Tasks tab is wide`.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement.** In `useInspector`, when the shown tab is `"tasks"` and it stops being offered, the existing rule (a tab outside `offered` does not show) already hides it; add nothing else.
- [ ] **Step 4: Run.** Expected: PASS, plus `pnpm vitest run src/test/use-inspector.test.tsx`.
- [ ] **Step 5: Commit** `feat: keep open task tabs and offer the Tasks tab`.

### Task 6: The Tasks tab's panels

**Files:**
- Create: `src/components/tasks/TaskTabs.tsx`, `src/components/tasks/SubagentTaskPanel.tsx`, `src/components/tasks/ShellTaskPanel.tsx`, `src/test/task-panels.test.tsx`
- Modify: `src/components/inspector/Inspector.tsx` (label `tasks: "Tasks"` with the open-tab count, `ORDER`, the panel switch), `src/lib/background-tasks.ts`

**Interfaces:**
- Consumes: `TaskTabs`, `subagentTaskOf`, `stepsOf`, `ToolCallList`, the chat's text renderer, `formatElapsed`.
- Produces in `background-tasks.ts`: `BackgroundTask.toolId?: string` (the shell tool call a process row claimed, or the tool's own id for a tool row; set in `dedupeToolTasks` / `runningToolTasks`).
- `TaskTabs({ tabs, selected, nameOf, isRunning, onSelect, onClose })`: a `role="tablist"` labelled "Open tasks"; each tab a `role="tab"` button plus a close `IconButton` labelled `"Close {name}"`.
- `SubagentTaskPanel({ task, parts, tools, agentName, thinking, isTextCut, now })`.
- `ShellTaskPanel({ task, output, reportedAt, agentName, onStop, now })` where `task` is a `BackgroundTask` and `output` the matched tool's text details joined.

Exact copy (artboard `TasksInspector`, `TasksMain`):
- Subagent header second line: `"{agentType} · subagent of {Agent} · started N min ago"`; finished: `"{agentType} · subagent of {Agent} · N steps in {elapsed}"`.
- Running footer, a `role="status"`: `"{agentType} is working"` (or `"The subagent is working"` without a type), the elapsed time, and `"Stop {Agent} to stop it"`.
- Finished: label `"What it told {Agent}"` over `lastText`, then `"This is {Agent}'s own report of what its subagent did. Rewinding the chat removes it too."`
- Cut text: `"The rest of its text was left out."`
- Shell: `"Shell · started by {Agent}"`, a `Stop` outline button, `Status` / `Listening on`, `"Output"` with `"as {Agent} last reported it, N min ago"`, and `"The command still runs. {Agent} stopped reporting its output when the tool call ended, so ask {Agent} for anything newer."` No output block when `output` is empty.

- [ ] **Step 1: Write the failing tests**: the strip (`selects a tab`, `closes a tab by its button`, `a running task shows it runs` by accessible text, not colour); subagent running (`shows its steps and that it is working`, `has no Stop button`); subagent finished (`shows what it told the agent and the report note`); `says when its text was cut`; shell (`stops the command`, `says the agent stopped reporting output`, `shows no output block without output`); `escapes control characters in a command`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/task-panels.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The subagent body renders `parts` with the chat's own components: a `tools` part through `ToolCallList` (child tools, `isTurnOver` from the task's status), a `text` part through the message text renderer `MessageRow` uses. It follows the bottom with the hook the chat uses for that. Commands and paths go through `escapeVisible`.
- [ ] **Step 4: Run** the file and `pnpm vitest run src/test/inspector.test.tsx src/test/sheet-fills.test.ts src/test/design-tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: follow a subagent or a shell command in the inspector`.

### Task 7: Wire Open, from the chat and from the popover

**Files:**
- Modify: `src/App.tsx` (prefer a new `src/hooks/useTaskTabsWiring.ts` over growing it), `src/hooks/useBackgroundTasks.ts`, `src/components/topbar/BackgroundTasksMenu.tsx`
- Test: `src/test/use-background-tasks.test.tsx`, `src/test/background-tasks-menu.test.tsx`, a new `src/test/task-tabs-app.test.tsx`

**Interfaces:**
- Consumes: `useTaskTabs`, `useInspector().show`, `BackgroundTask.toolId`.
- Produces: `BackgroundTasksArgs.onOpenTask?: (sessionId: string, tab: TaskTab) => void`. `open(task)` calls `onOpenSession(task.sessionId)`, then for `subagent` with a `toolId` whose tool has steps, or `shell`, `onOpenTask`; a working session's row opens the session only. The wiring's `openTask(sessionId, tab)` calls `taskTabs.open` then `inspector.show('tasks')`.
- Menu: `canOpen` is true for every kind; the last line reads `"Tasks keep running when you switch sessions. Open shows a task beside its chat. Stop ends the process."`

- [ ] **Step 1: Write the failing tests**: hook (`opening a subagent task opens its tab after selecting the session`, `opening a working session opens no tab`); menu (`a shell row has Open`, the new sentence); App level, with the fake backend sending Task 1's Qwen fixture as `acp-event` updates: `pressing a subagent's row opens its tab beside the chat`, `the Tasks tab goes when its last task tab closes`, `rewinding past the subagent closes its tab`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** No tab opens while the composer's place shows a compare run's or a removed agent's panel (there is no inspector for the session then): `openTask` returns early, the session is still selected.
- [ ] **Step 4: Run** the three files and `pnpm lint`. Expected: PASS, no warnings.
- [ ] **Step 5: Commit** `feat: open a background task as a tab`.

### Task 8: A fake agent that marks its subagent, and the docs

**Files:**
- Modify: `src-tauri/tests/fixtures/fake_acp_agent.mjs`, `src-tauri/tests/it/main.rs` (the `mod` line), `CLAUDE.md`, `CHANGELOG.md`
- Create: `src-tauri/tests/it/acp_subagent_test.rs`

**Interfaces:**
- `FAKE_ACP_SUBAGENT=qwen|claude`: a prompt `subagent` announces a tool call titled `agent`, then sends one child `tool_call`, its completion, one child `agent_message_chunk` and the parent's completion, with `_meta` in that agent's shape (as in Task 1's fixtures), then ends the turn.

- [ ] **Step 1: Write the failing test** `acp_subagent_test::relays_a_subagents_meta_unchanged`: start a session against the fake agent with `FAKE_ACP_SUBAGENT=qwen`, prompt `subagent`, collect the emitted updates, assert the child `tool_call`'s `_meta.parentToolCallId` equals the parent's `toolCallId`; the same with `claude` and `_meta.claudeCode.parentToolUseId`.
- [ ] **Step 2: Run** from `src-tauri/`: `cargo test --test it acp_subagent_test::`. Expected: FAIL (the fake agent ignores the prompt).
- [ ] **Step 3: Implement** the flag beside the other prompt branches (search the file for `user-question`).
- [ ] **Step 4: Run** the test, then `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`. Expected: PASS, clean.
- [ ] **Step 5: Document.** `CLAUDE.md`: a **Background task tabs** paragraph after **Activity log** (the three `ToolExecution` fields and who reads them, `acp-subagents.ts`, `task-view.ts`, `useTaskTabs`, the `tasks` tab that exists only while a tab is open, no Stop for a subagent, agents known to mark their subagents), and `FAKE_ACP_SUBAGENT` in the fake agent's flag list. `CHANGELOG.md`: `- A subagent or shell command an agent started opens as a tab beside the chat, and the chat shows one row per subagent.`
- [ ] **Step 6: Commit** `test: a fake agent that marks its subagent's updates` and `docs: describe background task tabs`.

### After the last task

- [ ] Replace `src/test/fixtures/acp-subagent-claude.json` with a recording from a signed-in Claude Code session and re-run Task 1's tests. Until then the PR says the Claude Code path is unverified.
- [ ] Check the three artboards against the running app in both themes (the real-app harness with the fake agent and `FAKE_ACP_SUBAGENT`), then `/code-review --fix` before the push.
