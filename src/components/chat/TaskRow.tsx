import { ChevronRight, Terminal, Users } from "lucide-react";
import { useNow } from "../../hooks/useNow";
import { formatElapsed, type BackgroundTask } from "../../lib/background-tasks";
import { escapeVisible } from "../../lib/visible-text";
import type { SubagentTask, TaskStatus } from "../../lib/task-view";

export interface TaskRowProps {
  task: SubagentTask;
  /** The subagent's type and how much it did, or why there is nothing to open. */
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
  const canOpen = Boolean(onOpen) && task.hasSteps;

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
  const steps = task.stepCount === 1 ? "1 step" : `${task.stepCount} steps`;
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

const PORT = /^localhost:\d+$/;

/** A command an agent left running, as a row at the end of the chat that opens its task. */
export function ShellTaskRow({ task, isOpen, onOpen }: { task: BackgroundTask; isOpen: boolean; onOpen: () => void }) {
  const now = useNow(1000);
  const command = escapeVisible(task.name);
  const ports = (task.detail ?? "").split(" · ").filter((part) => PORT.test(part));
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
