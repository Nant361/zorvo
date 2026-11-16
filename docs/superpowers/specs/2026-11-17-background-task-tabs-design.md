# Background task tabs — design

Date: 2026-11-17
Branch: `docs/background-task-tabs-spec`
Builds on: `2026-10-18-diff-view-background-tasks-design.md` (the top bar's background tasks menu), `2026-11-02-activity-log-design.md`, `2026-11-11-redesign-v2-design.md`
Artboards: canvas "Zorvo redesign v2", section 11 (`TasksMain`, `TasksInspector`, `TasksChatRows`); local copies in `2026-11-17-background-task-tabs-artboards/`. The canvas decides look and copy, this file decides behaviour.

## Goal

A background task can be opened and followed while it runs, beside the chat, the way another app shows a subagent in a side pane. Two kinds in this version: a **subagent** an agent started, and a **shell command** an agent started.

Success: with Claude Code or Qwen Code, pressing Open on a running subagent shows its steps as they arrive; the chat shows one row per subagent instead of every step; a shell command's tab shows what Zorvo knows about it and can stop it.

## What exists today

- The top bar chip "N background tasks" and its popover (`BackgroundTasksMenu`, `useBackgroundTasks`, `lib/background-tasks.ts`) list working sessions, shell processes and running subagent tool calls across all sessions.
- Open on a subagent row only selects its session (`useBackgroundTasks.open`). There is nothing to look at.
- A subagent is recognized by its tool name (`task`, `agent`), not by anything the agent says about its children.
- `lib/acp-events.ts` reads only `toolName` from `_meta`. Every update of a subagent (its tool calls, its text, its thinking) is folded into the parent's reply as if the parent had made it.

## What agents send (spike, 2026-11-17)

One short turn was run against each adapter with a throwaway ACP client.

**Qwen Code 0.27.0, recorded.** Every update a subagent makes carries, in `_meta`: `parentToolCallId` (the id of the `agent` tool call that started it), `subagentType` and `agent: { agentName, depth, kind: "subagent" }`. This holds for `tool_call`, `tool_call_update`, `agent_message_chunk` and `agent_thought_chunk`. The parent's own tool call gets `tool_call_update`s with `_meta.subagentProgress: true`. So today a Qwen subagent's text lands in the main reply.

**Claude Code (adapter 0.101.0), read from source, not recorded.** `stampParentToolUseId` puts `_meta.claudeCode.parentToolUseId` on a subagent's reports, and the adapter's comments say a plain client gets the streamed subagent text. The recording failed for reasons outside Zorvo: the 0.101.0 copy in the npx cache has a truncated `claude` binary (66 MB against 310 MB), and the 0.100.0 copy answered "Authentication required" from the spike's shell. A fixture must be captured from a signed-in run before the Claude Code path is called done.

**Codex and Antigravity: unknown.** Both are binaries; nothing was found in files. They are treated as agents that do not mark their subagents until a recording shows otherwise.

Not used in this version: the adapter's native subagent sessions (`subagent_update`), its `background` lists and the `subagent-transcript` capability. They change what the adapter sends for every session and need a spike of their own.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where a task opens | A tab per task in the inspector, with its name and a close button |
| 2 | What the chat shows for a subagent | One row; its steps are only in the tab |
| 3 | Shell tabs | Only what Zorvo already receives; Monitor, Workflow and live output of a detached command are out |
| 4 | Lists of tasks | Two, each with its own job: the top bar popover (every session, running only) and the chat rows (this session, in order, finished too). The inspector shows a task's content and never a list |

## Data

`ToolExecution` gains three optional fields:

- `parentId`: the tool call that started the subagent this tool belongs to.
- `agentType`: on the parent, the subagent's type as the agent names it (`Explore`, `general-purpose`), when reported.
- `steps`: on the parent, what its subagent did, in arrival order, as `ChatMessagePart[]` (`{ kind: 'text' }`, `{ kind: 'tools', toolIds }`), plus `thinking` kept the way a reply keeps it.

Rules in `lib/acp-events.ts` (pure, unit-tested with the recorded fixtures):

1. `parentToolIdOf(meta)` reads `claudeCode.parentToolUseId`, else top-level `parentToolCallId`. Anything that is not a non-empty string is no parent.
2. An update with a parent whose tool call is in the open reply is filed under it: a `tool_call` is added to `message.tools` with `parentId` and appended to the parent's `steps`, not to the reply's `parts`; a text chunk is appended to the parent's `steps`, not to `content`; a thought chunk goes to the parent's `thinking`.
3. An update with a parent that is not in the open reply (never announced, or from an earlier turn) is handled as today. Nothing is dropped.
4. A child tool stays in `message.tools`, so `lib/activity.ts`, `unreportedFiles` and the diff a tool row opens keep working unchanged. A file a subagent changed is still reported.
5. One level. A child's own subagent (`depth` 2) is filed under the nearest ancestor that is in the reply.

Persistence: the fields are optional and read leniently in `lib/persistence.ts` and `store.rs`; `STATE_VERSION` stays 2. A transcript saved before this shows as it does today. A load replay (`applyReplayUpdate`) uses the same rules.

Size: a subagent's text is cut at `MAX_SUBAGENT_TEXT` (20,000 characters, the cap delegation reports use) with a note that it was cut. Diffs are already kept as rows.

## The chat row

`ToolCallList` leaves out tools with a `parentId` and draws each tool that has `steps`, or is a subagent by today's name rule, as a task row: icon, the task's title, a second line (`{agentType} · N steps`), a status word with the elapsed time, and a chevron. The whole row is one button that opens the task's tab; the row of the tab on screen has the strong edge.

Status words, from the tool and the session: Working (running, session in a turn), Needs you (a pending permission whose tool call has this parent), Done, Failed, Did not finish (still `running` after the turn ended, the Activity tab's rule). Colour never stands alone.

A shell command gets a row only while its process is listed by the process scan or its tool call runs: the command in mono, `Shell · localhost:PORT`, Running and the time.

An agent that does not mark its subagent's updates keeps a row with no chevron and the second line "{Agent} doesn't report this subagent's steps". Its steps stay in the chat as today, since they cannot be told apart.

## The inspector

`InspectorTab` gains `"tasks"`. The segment shows only while at least one task tab is open for the session on screen, with the count of open tabs, and goes when the last one closes. It sits before Terminal and the inspector widens as for Terminal.

Under the tab bar a strip lists the open task tabs, like the Terminal tab's strip: name, a turning arc while the task runs, a close button. Open tabs are kept per session in memory (`hooks/useTaskTabs.ts`), not persisted; a tab whose task no longer exists (a rewind removed its message) closes by itself.

**Subagent tab.** Header: icon, title, `{agentType} · subagent of {Agent} · started N min ago`. Body: the `steps` drawn with the chat's own tool rows and text, following the bottom while it runs (the chat's follow rule). Footer while running: "{agentType} is working", the time, and "Stop {Agent} to stop it"; there is no Stop, because ACP can only cancel the parent's whole turn. Finished: the steps fold into the usual summary line, the subagent's last text is shown under "What it told {Agent}", and the note "This is {Agent}'s own report of what its subagent did. Rewinding the chat removes it too."

**Shell tab.** Header: the command, "Shell · started by {Agent}", Stop (`stop_background_process`, unchanged). Then Status and Listening on. Output: the text the tool call reported, on the terminal ground, with when it was last reported. While the process outlives its tool call: "The command still runs. {Agent} stopped reporting its output when the tool call ended, so ask {Agent} for anything newer." A process with no matching tool call has no output block.

Everything an agent wrote goes through `escapeVisible` or the chat's markdown renderer, as in the chat.

## The popover

`BackgroundTasksMenu` keeps its shape. Open now selects the session and opens the task's tab; shell rows get Open too. Its last line becomes "Tasks keep running when you switch sessions. Open shows a task beside its chat. Stop ends the process." A working session's row keeps opening the session only.

## Out of scope

Stopping one subagent; Monitor, Workflow and other tasks only the Claude Code adapter's capabilities list; live output of a detached command; task tabs in popouts (they have no inspector); a subagent's own subagents as their own tabs; opting into native subagent sessions.

## Errors and edges

- A tab's task is in a session that is not on screen: the popover's Open selects the session first.
- The session ends or the agent exits while a tab is open: the tab stays and reads Did not finish.
- A compare run's panel or a removed agent's panel is on screen: there is no inspector for the session, so Open selects the session as today.
- A permission request from a subagent still shows as a card in the chat; the row reads Needs you. The tab does not answer requests.

## Testing

- `acp-events` unit tests on the Qwen fixture (trimmed from the spike) and on a Claude Code fixture captured from a signed-in run: children filed under the parent, text kept out of `content`, an unknown parent handled as today, a replay giving the same result.
- `FAKE_ACP_SUBAGENT` on the fake agent: a prompt `subagent` announces an `agent` tool call and sends child updates in either agent's `_meta` shape, so a Rust integration test and an App-level test cover the path end to end.
- Component tests: the row's states, the tab strip (open, close, the segment appearing and going), the subagent tab running and finished, the shell tab with and without output, an agent that marks nothing.
- `persistence` tests: old transcripts load unchanged; the new fields survive a save and a load.
- `tauri-contract.test.ts` needs no change: no new command or event.

## Open points for review

1. The segment is named "Tasks". The top bar says "background tasks"; one name for both may be clearer.
2. A finished shell command has no row and no tab in this version, since nothing lists it after its process ends.
3. The Claude Code path rests on reading the adapter, not on a recording.
