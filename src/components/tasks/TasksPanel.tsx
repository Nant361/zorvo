import { taskTabKey, type TaskTab, type TaskTabs } from "../../hooks/useTaskTabs";
import { findShellTask, shellToolFor, type BackgroundTask } from "../../lib/background-tasks";
import { findTaskTool, stepsOf, subagentTaskOf } from "../../lib/task-view";
import { escapeVisible } from "../../lib/visible-text";
import type { ChatMessage } from "../../types";
import { ShellTaskPanel } from "./ShellTaskPanel";
import { SubagentTaskPanel } from "./SubagentTaskPanel";
import { TaskTabStrip, type TaskTabItem } from "./TaskTabStrip";

export interface TasksPanelProps {
  tabs: TaskTabs;
  sessionId: string;
  messages: readonly ChatMessage[];
  /** Everything running in the background, as the top bar lists it. */
  tasks: readonly BackgroundTask[];
  agentName: string;
  /** The session is in a turn: a subagent still marked running is working, not left unfinished. */
  isBusy: boolean;
  onStop: (task: BackgroundTask) => Promise<boolean>;
}

/** The Tasks tab: the open tasks as tabs, and the one selected: a subagent's steps or a shell command. */
export function TasksPanel({ tabs, sessionId, messages, tasks, agentName, isBusy, onStop }: TasksPanelProps) {
  const transcripts = { [sessionId]: messages };
  const subagentOf = (tab: TaskTab) => {
    const found = tab.kind === "subagent" ? findTaskTool(messages, tab.toolId) : undefined;
    if (!found) return undefined;
    const isTurnOver = Boolean(found.message.isComplete) || !isBusy;
    return { ...found, task: subagentTaskOf(found.tool, found.message, { isTurnOver }) };
  };
  const shellOf = (tab: TaskTab) => (tab.kind === "shell" ? findShellTask(tasks, tab.taskId, transcripts) : undefined);

  const items: TaskTabItem[] = tabs.tabs.map((tab) => {
    const subagent = subagentOf(tab);
    const shell = shellOf(tab);
    return {
      key: taskTabKey(tab),
      name: subagent?.task.title ?? (shell ? escapeVisible(shell.name) : "Task"),
      isRunning: shell !== undefined || subagent?.task.status === "Working" || subagent?.task.status === "Needs you",
      isMono: tab.kind === "shell",
    };
  });
  const byKey = new Map(tabs.tabs.map((tab) => [taskTabKey(tab), tab]));
  const act = (run: (tab: TaskTab) => void) => (key: string) => {
    const tab = byKey.get(key);
    if (tab) run(tab);
  };

  const selected = tabs.selected;
  const subagent = selected && subagentOf(selected);
  const shell = selected && shellOf(selected);
  const shellTool = shell ? shellToolFor(shell, messages) : undefined;
  const output = shellTool?.details?.flatMap((detail) => (detail.kind === "text" ? [detail.text] : [])).join("\n");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskTabStrip items={items} selectedKey={selected ? taskTabKey(selected) : null} onSelect={act(tabs.select)} onClose={act(tabs.close)} />
      {subagent && (
        <SubagentTaskPanel
          key={subagent.tool.id}
          task={subagent.task}
          {...stepsOf(subagent.tool, subagent.message)}
          thinking={subagent.tool.thinking}
          isTextCut={subagent.tool.isTextCut}
          agentName={agentName}
        />
      )}
      {shell && (
        <ShellTaskPanel
          key={shell.id}
          task={shell}
          output={output || undefined}
          isReporting={shellTool?.status === "running"}
          agentName={agentName}
          onStop={onStop}
        />
      )}
    </div>
  );
}
