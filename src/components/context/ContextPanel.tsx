import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, RotateCw } from "lucide-react";
import type { ChatMessage, ContextUsage } from "../../types";
import { useContextBreakdown } from "../../hooks/useContextBreakdown";
import {
  agentFills,
  barParts,
  bufferOf,
  compactTokens,
  moneyText,
  contextTotals,
  percentText,
  shareOf,
  transcriptChars,
  zorvoFills,
  type FillRow,
} from "../../lib/context-usage";
import { escapeVisible } from "../../lib/visible-text";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

export interface ContextPanelProps {
  sessionId: string;
  agentId: string;
  agentName: string;
  /** The session's folder, where Zorvo looks for instruction files. */
  cwd: string;
  usage: ContextUsage;
  /** `usage.used` at each turn end. */
  turnUsage: readonly number[];
  /** Changes at every turn end, so the breakdown is asked again then. */
  turnsEnded: number;
  messages: readonly ChatMessage[];
  /** The agent's `compact` or `compress` command; null when it has neither, or when its session is not running. */
  compactCommand: string | null;
  /** A turn runs: Compact waits for it to end. */
  isBusy: boolean;
  onCompact: (command: string) => void;
}

const exact = (n: number) => n.toLocaleString("en-US");

/** A small muted heading, with an optional note on its right, over its content. */
function Section({ heading, aside, children }: { heading: string; aside?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-caption font-medium text-fg-muted">
          {heading}
        </h2>
        {aside && <span className="min-w-0 truncate text-caption text-fg-subtle">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="flex-1 text-fg-muted">{name}</dt>
      <dd className="tabular-nums text-fg-secondary">{value}</dd>
    </div>
  );
}

/** One row of "What fills it"; a row with items opens to list them. */
function FillLine({ row, size }: { row: FillRow; size: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const mark = row.isEstimate ? "~" : "";
  const share = shareOf(row.tokens, size);
  const amount = (
    <span className="ml-auto flex shrink-0 gap-3 tabular-nums">
      <span className="text-fg-secondary">{mark + compactTokens(row.tokens)}</span>
      {share !== null && <span className="w-12 text-right text-fg-subtle">{share}</span>}
    </span>
  );
  const hasItems = row.items.length > 0;
  return (
    <li className="border-b border-border last:border-b-0">
      {hasItems ? (
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full items-center gap-1.5 rounded py-2 text-left text-fg-muted hover:text-fg-secondary focus-ring"
        >
          <ChevronRight aria-hidden="true" className={`size-3.5 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          <span className="min-w-0 truncate">{row.label}</span>
          {amount}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 py-2 pl-5 text-fg-muted">
          <span className="min-w-0 truncate">{row.label}</span>
          {amount}
        </div>
      )}
      {hasItems && isOpen && (
        <ul className="pb-2 pl-5 font-mono text-caption">
          {row.items.map((item) => (
            <li key={item.name} className="flex gap-3 py-0.5">
              <span className="min-w-0 truncate text-fg-muted">{escapeVisible(item.name)}</span>
              <span className="ml-auto shrink-0 tabular-nums text-fg-subtle">{mark + compactTokens(item.tokens)}</span>
            </li>
          ))}
          {row.more > 0 && <li className="py-0.5 text-fg-subtle">and {row.more} more</li>}
        </ul>
      )}
    </li>
  );
}

/** The window as a bar: what is used, what is free, and the buffer the agent keeps back. */
function WindowBar({ used, free, buffer, isNearlyFull }: { used: number; free: number; buffer: number; isNearlyFull: boolean }) {
  const total = used + free + buffer;
  const width = (n: number) => `${(n / total) * 100}%`;
  return (
    <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-surface-hover">
      <div className={isNearlyFull ? "bg-status-attention" : "bg-fg-secondary"} style={{ width: width(used) }} />
      <div style={{ width: width(free) }} />
      {buffer > 0 && <div className="bg-border-strong" style={{ width: width(buffer) }} />}
    </div>
  );
}

/** Context used at each turn end, as bars against the largest. */
function TurnChart({ points }: { points: readonly number[] }) {
  if (points.length === 0) return <p className="text-ui-sm text-fg-subtle">Shows once a turn ends.</p>;
  const top = Math.max(...points, 1);
  const label = `Context used at the end of each turn, oldest first: ${points.map(compactTokens).join(", ")} tokens.`;
  return (
    <div role="img" aria-label={label} className="flex h-12 items-end gap-1">
      {points.map((used, index) => (
        <div
          // The points only ever grow at the end, so a turn's place is its key.
          key={index}
          title={`${exact(used)} tokens`}
          className="min-w-0 max-w-2.5 flex-1 rounded-sm bg-fg-subtle"
          style={{ height: `${Math.max(4, (used / top) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** The inspector's Context tab: how full the window is, what fills it, and how it grew turn by turn. */
export function ContextPanel(props: ContextPanelProps) {
  const { sessionId, agentId, agentName, cwd, usage, turnUsage, turnsEnded, messages, compactCommand, isBusy, onCompact } = props;
  const { breakdown, files, isLoading, refresh } = useContextBreakdown(sessionId, agentId, cwd, turnsEnded);
  const totals = contextTotals(usage);
  const bar = barParts(totals, bufferOf(breakdown));
  const fills = breakdown ? agentFills(breakdown) : totals.size > 0 ? zorvoFills(totals.used, transcriptChars(messages), files) : [];
  const model = breakdown?.modelName;

  return (
    <aside aria-label="Context panel" className="flex h-full min-h-0 flex-1 flex-col text-ui text-fg-secondary">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        {(compactCommand || agentId === "qwen-code") && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {compactCommand && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  title={isBusy ? `Waits for ${agentName} to finish` : undefined}
                  onClick={() => onCompact(compactCommand)}
                >
                  {compactCommand === "compress" ? "Compress context" : "Compact context"}
                </Button>
              )}
              {agentId === "qwen-code" && (
                <IconButton label="Refresh" size="sm" disabled={isLoading} onClick={refresh} className="ml-auto">
                  <RotateCw aria-hidden="true" className="size-3.5" />
                </IconButton>
              )}
            </div>
            {compactCommand && (
              <p className="text-caption text-fg-subtle">
                {compactCommand === "compress" ? "Compress" : "Compact"} context sends /{compactCommand} to {agentName}.
              </p>
            )}
          </div>
        )}
        <Section heading="Context" aside={model ? `${agentName} · ${model}` : agentName}>
          {totals.percent !== null ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-2xl font-semibold leading-[30px] tracking-[-0.02em] text-fg">{percentText(totals.percent)}</span>
                <span className="font-mono text-caption tabular-nums text-fg-muted">
                  {compactTokens(totals.used)} / {compactTokens(totals.size)} tokens
                </span>
              </div>
              {bar && <WindowBar {...bar} isNearlyFull={totals.isNearlyFull} />}
              {totals.isNearlyFull ? (
                <p className="flex gap-1.5 text-ui-sm text-status-attention">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  The window is nearly full. {agentName} may summarize older messages on its own.
                </p>
              ) : (
                <p className="text-ui-sm text-fg-subtle">{compactTokens(totals.left ?? 0)} left before the window is full</p>
              )}
            </>
          ) : (
            <>
              <span className="text-2xl font-semibold leading-[30px] tracking-[-0.02em] text-fg">
                {compactTokens(totals.used)} <span className="text-ui-sm font-medium tracking-normal text-fg-muted">tokens used</span>
              </span>
              <p className="text-ui-sm text-fg-subtle">
                {agentName} does not say how big its window is, so Zorvo cannot show how much is left.
              </p>
            </>
          )}
        </Section>

        <dl className="flex flex-col text-ui-sm">
          <Row name="Used" value={exact(totals.used)} />
          {bar && bar.buffer > 0 ? (
            <>
              <Row name="Free" value={exact(bar.free)} />
              <Row name="Autocompact buffer" value={exact(bar.buffer)} />
            </>
          ) : (
            totals.left !== null && <Row name="Left" value={exact(totals.left)} />
          )}
          {usage.cost && <Row name="Session cost" value={moneyText(usage.cost)} />}
        </dl>

        {fills.length > 0 && (
          <Section heading="What fills it" aside={breakdown ? `Estimated by ${agentName}` : "Estimated by Zorvo"}>
            <ul aria-busy={isLoading} className="flex flex-col text-ui-sm">
              {fills.map((row) => (
                <FillLine key={row.label} row={row} size={totals.size} />
              ))}
            </ul>
            {!breakdown && (
              <p className="text-ui-sm text-fg-subtle">
                {agentName} reports only the total. Zorvo counts the chat and the instruction files itself; everything else is
                system prompt, tools, skills and memory together.
              </p>
            )}
          </Section>
        )}

        <Section heading="After each turn">
          <TurnChart points={turnUsage} />
        </Section>

      </div>
    </aside>
  );
}
