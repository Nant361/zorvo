import type { ReactNode } from "react";
import { Check, Plus } from "lucide-react";
import { AgentTile } from "../ui/AgentTile";
import { AgentMultiPicker, type AgentMultiPickerProps } from "./AgentMultiPicker";
import { SIGN_IN_LABELS } from "../../lib/agent-sign-in";
import { shownTiles } from "../../lib/agent-tiles";
import type { AgentChoice } from "../../lib/composer-controls";

export interface AgentChipRowProps extends AgentMultiPickerProps {
  /** In a repository several agents can be ticked for a compare run; elsewhere a press picks one. */
  canTick: boolean;
  /** The model picker joined to a picked agent's chip; nothing for an agent that offers none. */
  modelOf?: (agentId: string) => ReactNode;
  /** While Private is on: every agent but this one stays in the row but cannot be picked, with the reason as its title. */
  lockedTo?: { agentId: string; reason: string };
}

/** What a blocked chip says after its name; a ready one says nothing, so the row stays short. */
function blockedWord(option: AgentChoice): { word: string; dot?: string } | undefined {
  if (option.blockedBy === "install") return { word: "Not installed" };
  if (option.blockedBy === "sign-in") return { word: SIGN_IN_LABELS.needed, dot: "bg-status-attention" };
  return undefined;
}

const CHIP =
  "focus-ring inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md pl-1 pr-2 text-ui-sm transition-colors";

/**
 * The draft's agents as a row of chips at the top of the composer's card: the first four in use, each a toggle
 * with its logo, name and a check while picked. A picked agent's chip carries its model picker as a second button
 * joined to it. A chip that needs an install or a sign-in picks that agent alone, which shows what it needs, and
 * **+** opens every agent ("All agents").
 */
export function AgentChipRow({
  options,
  selected,
  canTick,
  isOpen,
  onToggle,
  onClose,
  onChange,
  onPick,
  modelOf,
  lockedTo,
}: AgentChipRowProps) {
  const chips = shownTiles(options, selected);
  // The only agent needs an install or a sign-in: its own panel comes before any compare.
  const onlyAgent = selected.length === 1 ? options.find((option) => option.value === selected[0]) : undefined;
  const isOnlyBlocked = onlyAgent?.blockedBy !== undefined;

  return (
    <div role="group" aria-label="Agents for this task" data-agent-chips="" className="flex flex-wrap items-center gap-1">
      {chips.map((listed) => {
        // A private launch skips the agent's own sign-in: while Private holds this agent, a sign-in blocks nothing.
        const isPrivateAgent = lockedTo?.agentId === listed.value;
        const option = isPrivateAgent && listed.blockedBy === "sign-in" ? { ...listed, blockedBy: undefined } : listed;
        const isChosen = selected.includes(option.value);
        const isBlocked = option.blockedBy !== undefined;
        const isLocked = lockedTo !== undefined && !isPrivateAgent;
        const picksAlone = isBlocked || !canTick || (isOnlyBlocked && !isChosen);
        const blocked = blockedWord(option);
        const label = option.blockedBy === "install" ? `${option.name}, install first` : `${option.name}, sign in first`;
        // The private models stay on offer whatever the agent needs: they show what the session would run on.
        const model = isChosen && (!isBlocked || isPrivateAgent) ? modelOf?.(option.value) : undefined;
        const chip = (
          <button
            key={option.value}
            type="button"
            data-agent-tile={option.value}
            aria-label={isBlocked ? label : option.name}
            // A blocked agent is never ticked: pressing it shows what it needs.
            aria-pressed={isBlocked ? undefined : isChosen}
            // Still focusable while locked, so its reason is read with it.
            aria-disabled={isLocked || undefined}
            title={isLocked ? lockedTo?.reason : undefined}
            onClick={isLocked ? undefined : () => (picksAlone ? onPick(option.value) : onChange(option.value))}
            className={`${CHIP} ${
              isLocked
                ? "cursor-not-allowed text-fg-subtle"
                : isChosen
                  ? `text-fg ${isBlocked ? "" : "font-medium"} ${model ? "" : "bg-chip"}`
                  : "text-fg-secondary hover:bg-surface-hover"
            }`}
          >
            <AgentTile profileId={option.value} name="" size={16} />
            <span className="truncate">{option.name}</span>
            {blocked ? (
              <span className="flex items-center gap-1 text-caption font-normal text-fg-muted">
                {blocked.dot && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${blocked.dot}`} />}
                <span>{blocked.word}</span>
              </span>
            ) : (
              isChosen && <Check size={12} aria-hidden="true" className="shrink-0" />
            )}
          </button>
        );
        // A picked agent and its model read as one control: one fill, a hairline between the two buttons.
        return model ? (
          <span key={option.value} data-agent-group={option.value} className="inline-flex min-w-0 items-center rounded-md bg-chip">
            {chip}
            {model}
          </span>
        ) : (
          chip
        );
      })}
      {lockedTo !== undefined ? (
        <button
          type="button"
          aria-label="All agents"
          aria-disabled="true"
          title={lockedTo.reason}
          className="focus-ring flex size-7 cursor-not-allowed items-center justify-center rounded-md text-fg-subtle"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      ) : (
        <AgentMultiPicker
          options={options}
          selected={selected}
          canTick={canTick}
          isOpen={isOpen}
          onToggle={onToggle}
          onClose={onClose}
          onChange={onChange}
          // Picking one agent is an answer: the list closes.
          onPick={(agentId) => {
            onPick(agentId);
            (onClose ?? onToggle)();
          }}
        />
      )}
    </div>
  );
}

