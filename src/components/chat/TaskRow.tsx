import { ChevronRight, Terminal, Users } from "lucide-react";
import { useNow } from "../../hooks/useNow";
import { findShellTask, formatElapsed, portsOf, type BackgroundTask } from "../../lib/background-tasks";
import type { ChatMessage } from "../../types";
import { escapeVisible } from "../../lib/visible-text";
import { stepsLabel, type SubagentTask, type TaskStatus } from "../../lib/task-view";

export interface TaskRowProps {
  task: SubagentTask;
  /** The subagent's type and how much it did. */
  secondLine: string;
  /** Its task tab is the one on screen. */
  isOpen: boolean;
  /** Opens the task beside the chat; absent where nothing can show it (a popout). */
  onOpen?: () => void;
}

/** Colour never stands alone: the word says the state. */
const STATUS_CLASSES: Record<TaskStatus, string> = {
  Working: "text-status-running",
  "Needs you": "text-status-attention",
  Done: "text-fg-muted",
  Failed: "text-danger",
  "Did not finish": "text-fg-muted",
};

const FRAME = "flex w-full items-center gap-2.5 rounded-lg border bg-surface-2 px-2.5 py-2 text-left";

/** A subagent as one row in the reply: what it is for, how far it is, and a way to follow it. */
export function TaskRow({ task, secondLine, isOpen, onOpen }: TaskRowProps) {
  const isLive = task.status === "Working" || task.status === "Needs you";
  const now = useNow(1000, isLive && task.startedAt !== undefined);
  const elapsed = isLive && task.startedAt !== undefined ? formatElapsed(now - task.startedAt) : undefined;
  const canOpen = Boolean(onOpen);

  const body = (
    <>
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-secondary">
        <Users size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui text-fg" title={task.title}>
          {task.title}
        </span>
        <span className="truncate text-caption text-fg-subtle">{secondLine}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end text-caption">
        <span className={STATUS_CLASSES[task.status]}>{task.status}</span>
        {elapsed && <span className="font-mono tabular-nums text-fg-subtle">{elapsed}</span>}
      </span>
      {canOpen && <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />}
    </>
  );

  if (!canOpen) {
    return (
      <div data-task-row="" className={`${FRAME} border-border`}>
        {body}
      </div>
    );
  }
  const steps = stepsLabel(task.stepCount);
  return (
    <button
      type="button"
      data-task-row=""
      aria-pressed={isOpen}
      aria-label={`Open ${task.title}. ${task.status}, ${steps}.`}
      onClick={onOpen}
      className={`${FRAME} focus-ring cursor-pointer transition-colors hover:bg-surface-hover ${isOpen ? "border-border-strong" : "border-border"}`}
    >
      {body}
    </button>
  );
}

/** A command an agent left running, as a row at the end of the chat that opens its task. */
export function ShellTaskRow({ task, isOpen, onOpen }: { task: BackgroundTask; isOpen: boolean; onOpen: () => void }) {
  const now = useNow(1000);
  const command = escapeVisible(task.name);
  const ports = portsOf(task);
  return (
    <button
      type="button"
      data-task-row=""
      aria-pressed={isOpen}
      aria-label={`Open ${command}. Running.`}
      onClick={onOpen}
      className={`${FRAME} focus-ring cursor-pointer transition-colors hover:bg-surface-hover ${isOpen ? "border-border-strong" : "border-border"}`}
    >
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-secondary">
        <Terminal size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-ui-sm text-fg" title={command}>
          {command}
        </span>
        <span className="truncate text-caption text-fg-subtle">{["Shell", ...ports].join(" · ")}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end text-caption">
        <span className="text-status-running">Running</span>
        <span className="font-mono tabular-nums text-fg-subtle">{formatElapsed(now - task.startedAt)}</span>
      </span>
      <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
    </button>
  );
}

export interface ShellTaskRowsProps {
  /** The session's shell tasks. */
  tasks: readonly BackgroundTask[];
  /** The shell tab on screen, which may name the command's tool row after it became a process. */
  openTaskId?: string;
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>;
  onOpen: (task: BackgroundTask) => void;
}

/** The commands a session's agent left running, one row each, after the last message. */
export function ShellTaskRows({ tasks, openTaskId, transcripts, onOpen }: ShellTaskRowsProps) {
  if (tasks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task) => (
        <ShellTaskRow
          key={task.id}
          task={task}
          isOpen={openTaskId !== undefined && findShellTask([task], openTaskId, transcripts) === task}
          onOpen={() => onOpen(task)}
        />
      ))}
    </div>
  );
}
