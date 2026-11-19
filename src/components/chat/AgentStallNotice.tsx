import { useEffect, useState } from "react";
import { Clock, Power, Square } from "lucide-react";
import { Button } from "../ui/Button";
import {
  activityKeyOf,
  runningToolOf,
  stallNoticeParts,
  stopIgnoredParts,
  STOP_IGNORED_MS,
  type AgentFailures,
} from "../../lib/agent-stall";
import type { ChatMessage } from "../../types";

const CHECK_EVERY_MS = 1000;

export interface AgentStallNoticeProps {
  agentName: string;
  messages: readonly ChatMessage[];
  /** Failed requests the agent reported in a row. */
  failures?: AgentFailures;
  onStop?: () => void;
  /** When the user pressed Stop in this turn, until the turn ends. */
  stopAskedAt?: number;
  /** Ends the agent's process, for a Stop it does not act on. */
  onEndAgent?: () => void;
}

/**
 * A soft warning under "Working…" when the agent reports failing requests, has
 * sent nothing for a minute, or has run one tool for five minutes without news.
 * It says only what is known, never a cause, and goes away on the agent's next
 * news. Ten seconds after a Stop the agent has not acted on, it offers End agent.
 */
export function AgentStallNotice({ agentName, messages, failures, onStop, stopAskedAt, onEndAgent }: AgentStallNoticeProps) {
  const activityKey = activityKeyOf(messages);
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  // The agent sent news: silence counts from here.
  useEffect(() => {
    const at = Date.now();
    setSince(at);
    setNow(at);
  }, [activityKey]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  // A running tool gets longer before the notice: builds and tests take minutes.
  const runningTool = runningToolOf(messages);
  const silentForMs = Math.max(0, now - since);
  // An agent that waits on a stuck tool may never end the turn: only ending its process stops it.
  const isStopIgnored = onEndAgent !== undefined && stopAskedAt !== undefined && now - stopAskedAt >= STOP_IGNORED_MS;
  const parts = isStopIgnored
    ? stopIgnoredParts(agentName)
    : stallNoticeParts(agentName, { failures, runningTool, silentForMs });
  if (!parts) return null;

  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-chat items-center gap-3 rounded-xl border border-border bg-surface-2 py-3 pr-3 pl-4"
    >
      <Clock size={14} aria-hidden="true" className="shrink-0 text-status-attention" />
      <span className="flex min-w-0 flex-1 flex-col text-ui">
        <span data-notice-title="" className="font-semibold text-fg">{parts.title}</span>
        {parts.body && <span data-notice-body="" className="text-fg-muted">{" "}{parts.body}</span>}
      </span>
      {isStopIgnored ? (
        <Button variant="outline" icon={<Power size={10} aria-hidden="true" />} className="shrink-0" onClick={onEndAgent}>
          End agent
        </Button>
      ) : onStop && (
        <Button variant="outline" icon={<Square size={10} aria-hidden="true" />} className="shrink-0" onClick={onStop}>
          Stop
        </Button>
      )}
    </div>
  );
}
