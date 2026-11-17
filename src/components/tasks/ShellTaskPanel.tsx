import { useState } from "react";
import { Terminal } from "lucide-react";
import { Button } from "../ui/Button";
import { useNow } from "../../hooks/useNow";
import { formatElapsed, portsOf, type BackgroundTask } from "../../lib/background-tasks";
import { escapeVisible, escapeVisibleLines } from "../../lib/visible-text";
import { TaskHeader, TaskNote } from "./TaskHeader";

export interface ShellTaskPanelProps {
  task: BackgroundTask;
  /** What the command's tool call reported; absent when no tool call is known for it. */
  output?: string;
  /** The tool call still runs, so the agent is still reporting. */
  isReporting: boolean;
  agentName: string;
  /** Resolves false when the command could not be stopped. */
  onStop: (task: BackgroundTask) => Promise<boolean>;
}

/** A command an agent started: what Zorvo knows about it, the output the agent reported, and Stop. */
export function ShellTaskPanel({ task, output, isReporting, agentName, onStop }: ShellTaskPanelProps) {
  const now = useNow(1000);
  const [isStopping, setIsStopping] = useState(false);
  const command = escapeVisible(task.name);
  const ports = portsOf(task);

  const stop = () => {
    setIsStopping(true);
    void onStop(task).then((isStopped) => {
      if (!isStopped) setIsStopping(false);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskHeader
        icon={<Terminal size={14} />}
        title={command}
        isMono
        detail={`Shell · started by ${agentName}`}
        action={
          task.pid !== undefined && (
            <Button variant="outline" size="sm" aria-label={`Stop ${command}`} className="shrink-0" disabled={isStopping} onClick={stop}>
              {isStopping ? "Stopping…" : "Stop"}
            </Button>
          )
        }
      />
      <dl className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3.5 pb-3.5 text-ui-sm">
        <div className="flex gap-3">
          <dt className="w-20 shrink-0 text-fg-muted">Status</dt>
          <dd className="flex items-center gap-1.5">
            <span className="text-status-running">Running</span>
            <span className="font-mono text-caption tabular-nums text-fg-subtle">{formatElapsed(now - task.startedAt)}</span>
          </dd>
        </div>
        {ports.length > 0 && (
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-fg-muted">Listening on</dt>
            <dd className="font-mono text-caption text-fg-secondary">{ports.join(", ")}</dd>
          </div>
        )}
      </dl>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3.5">
        {output ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-ui-sm font-semibold text-fg">Output</span>
              <span className="text-caption text-fg-subtle">as {agentName} last reported it</span>
            </div>
            <pre
              aria-label="Command output"
              className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-terminal-bg px-3 py-2.5 font-mono text-caption text-terminal-fg select-text"
            >
              {escapeVisibleLines(output)}
            </pre>
            {!isReporting && (
              <TaskNote>
                The command still runs. {agentName} stopped reporting its output when the tool call ended, so ask {agentName} for
                anything newer.
              </TaskNote>
            )}
          </>
        ) : (
          <TaskNote>{agentName} reported no output for this command.</TaskNote>
        )}
      </div>
    </div>
  );
}
