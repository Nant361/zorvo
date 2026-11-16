import { useId, useState } from "react";
import { AgentTile } from "./ui/AgentTile";
import { UserQuestionsForm, type QuestionAnswers } from "./UserQuestionsForm";
import { orderedChoices, questionsOutcome, questionsTitle } from "../lib/permission-copy";
import { EMPTY_DRAFT, type QuestionDraft } from "../lib/user-questions";
import type { ActionCard as ActionCardType, UserQuestion } from "../types";

export interface QuestionsCardProps {
  card: ActionCardType;
  /** The card's questions, already checked (`usableQuestions`). */
  questions: UserQuestion[];
  agentName: string;
  agentProfileId?: string;
  onChoose?: (optionId: string, answers?: QuestionAnswers) => void;
  disabled: boolean;
}

/** How an answered card ended, by the kind of the option chosen; never what was answered. */
function settledLine(card: ActionCardType, agentName: string, count: number): string {
  const chosen = card.options?.find((option) => option.optionId === card.chosenOptionId);
  if (!chosen) return "This request was not answered.";
  return questionsOutcome(agentName, count, chosen.kind.startsWith("allow") ? "answered" : "cancelled");
}

/**
 * Qwen Code's `ask_user_question` as a form card: neutral like the agent's other forms, not the
 * attention colour of a permission request, since it asks for an answer rather than for leave.
 * The agent's own title for the request ("Ask user 2 questions") only repeats the card's, so it is
 * not shown.
 */
export function QuestionsCard({ card, questions, agentName, agentProfileId, onChoose, disabled }: QuestionsCardProps) {
  // What is picked or typed lives here, in memory, so an answer that did not go through keeps it. It is never stored.
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const setDraft = (index: number, draft: QuestionDraft) =>
    setDrafts((prev) => questions.map((_, i) => (i === index ? draft : (prev[i] ?? EMPTY_DRAFT))));
  const isPending = card.status === "pending";
  const titleId = useId();

  return (
    <section
      data-testid={`action-card-${card.id}`}
      aria-labelledby={titleId}
      className="my-3 flex flex-col gap-3.5 rounded-xl border border-border-strong bg-surface-2 p-4 text-left"
    >
      <div className="flex items-center gap-2">
        <AgentTile profileId={agentProfileId ?? ""} name="" size={22} />
        <h2 id={titleId} className="min-w-0 flex-1 text-ui font-semibold text-fg">
          {questionsTitle(agentName, questions.length)}
        </h2>
        {isPending && <span className="shrink-0 text-caption text-fg-muted">Waiting for you</span>}
      </div>

      {isPending && card.modeChanged && (
        <p className="text-caption text-fg-subtle">
          The permission mode changed after the agent asked. This request was made before the switch, so it still needs an answer.
        </p>
      )}

      {isPending ? (
        <UserQuestionsForm
          questions={questions}
          drafts={drafts}
          onChange={setDraft}
          options={orderedChoices(card.options ?? [])}
          onChoose={onChoose}
          disabled={disabled}
        />
      ) : (
        <p className="text-ui-sm text-fg-muted">{settledLine(card, agentName, questions.length)}</p>
      )}
    </section>
  );
}
