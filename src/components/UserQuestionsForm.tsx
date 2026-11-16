import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { PermissionChoice, UserQuestion } from "../types";
import { EMPTY_DRAFT, answerOf, answersOf, questionName, submitHint, type QuestionDraft } from "../lib/user-questions";
import { Button } from "./ui/Button";
import { UserQuestionField } from "./UserQuestionField";

/** The typed answers of Qwen Code's `ask_user_question`: question number to text. */
export type QuestionAnswers = Record<string, string>;

export interface UserQuestionsFormProps {
  questions: UserQuestion[];
  /** What is picked or typed, per question. The card owns it, so it survives an answer that did not go through. */
  drafts: readonly QuestionDraft[];
  onChange: (index: number, draft: QuestionDraft) => void;
  /** The agent's own options, in the card's order: the ones that turn the questions down first. */
  options: readonly PermissionChoice[];
  /** Picks one of the agent's options; an allowing one carries the answers. */
  onChoose?: (optionId: string, answers?: QuestionAnswers) => void;
  disabled: boolean;
}

const STEP =
  "focus-ring inline-flex h-6.5 items-center gap-1.5 rounded-md border px-2.5 text-ui-sm transition-colors";

/**
 * The questions one at a time: a step for each (only when there are several), the question
 * shown, and the agent's options with Back and Next. Submit, the agent's allowing option, takes
 * Next's place on the last step and on any step once every question has an answer; while one is
 * missing it stays off and the line beside it names what is missing. Picking an option never
 * moves on by itself: arrow keys change a radio group's pick, and would skip a question.
 */
export function UserQuestionsForm({ questions, drafts, onChange, options, onChoose, disabled }: UserQuestionsFormProps) {
  const [step, setStep] = useState(0);
  const statusId = useId();
  const questionRef = useRef<HTMLFieldSetElement>(null);
  // Set by Back, Next and the steps, so the question they open takes the focus; never on the first render.
  const hasMoved = useRef(false);

  const current = Math.min(step, questions.length - 1);
  const hasSteps = questions.length > 1;
  const answers = answersOf(questions, drafts);
  const hint = submitHint(questions, drafts);
  const showsSubmit = current === questions.length - 1 || answers !== undefined;
  const isSubmitBlocked = showsSubmit && hint !== undefined;
  const draftOf = (index: number) => drafts[index] ?? EMPTY_DRAFT;

  useEffect(() => {
    if (!hasMoved.current) return;
    hasMoved.current = false;
    const fieldset = questionRef.current;
    const controls = [...(fieldset?.querySelectorAll<HTMLInputElement>("input[type=radio]:enabled, input[type=checkbox]:enabled") ?? [])];
    // A disabled card has no control to take it, and the button pressed may be gone: the question takes it.
    (controls.find((control) => control.checked) ?? controls[0] ?? fieldset)?.focus();
  }, [current]);

  const goTo = (index: number) => {
    if (index === current) return;
    hasMoved.current = true;
    setStep(index);
  };

  const declines = options.filter((option) => !option.kind.startsWith("allow"));
  const allows = options.filter((option) => option.kind.startsWith("allow"));
  const submitWith = allows[allows.length - 1];
  // Enter in the Other box does what the primary button beside it would.
  const onEnter = () => {
    if (!showsSubmit) goTo(current + 1);
    else if (answers && submitWith && !disabled) onChoose?.(submitWith.optionId, answers);
  };

  return (
    <>
      {hasSteps && (
        <ol aria-label="Questions" className="flex flex-wrap gap-1.5">
          {questions.map((question, index) => {
            const isAnswered = answerOf(question, draftOf(index)) !== undefined;
            const isCurrent = index === current;
            const name = questionName(question, index);
            const tone = isCurrent
              ? "border-border-strong bg-surface-hover text-fg"
              : "border-border text-fg-muted hover:bg-surface-hover hover:text-fg";
            return (
              <li key={index}>
                <button
                  type="button"
                  className={`${STEP} ${tone}`}
                  aria-current={isCurrent ? "step" : undefined}
                  // The check mark is hidden from screen readers, so the name says it.
                  aria-label={isAnswered ? `${name} (answered)` : name}
                  onClick={() => goTo(index)}
                >
                  {isAnswered && <Check className="size-3 text-status-running" aria-hidden="true" />}
                  {/* Only once Submit waits on it: before that, an open question is not a problem. */}
                  {!isAnswered && showsSubmit && <span className="size-1.5 rounded-full bg-status-attention" aria-hidden="true" />}
                  {name}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <UserQuestionField
        key={current}
        ref={questionRef}
        question={questions[current]}
        draft={draftOf(current)}
        onChange={(draft) => onChange(current, draft)}
        disabled={disabled}
        showsHeader={!hasSteps}
        onEnter={onEnter}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="min-w-0 flex-1 text-ui-sm text-fg-muted">
          {/* Not announced: moving to a question already puts the focus, and its name, there. */}
          {!isSubmitBlocked && hasSteps && <span>{`Question ${current + 1} of ${questions.length}`}</span>}
          <span id={statusId} role="status">
            {isSubmitBlocked ? hint : ""}
          </span>
        </p>
        {declines.map((option) => (
          <Button key={option.optionId} variant="ghost" tone="secondary" disabled={disabled} onClick={() => onChoose?.(option.optionId)}>
            {option.name}
          </Button>
        ))}
        {current > 0 && (
          <Button variant="outline" onClick={() => goTo(current - 1)}>
            Back
          </Button>
        )}
        {showsSubmit ? (
          allows.map((option, index) => (
            <Button
              key={option.optionId}
              variant={index === allows.length - 1 ? "primary" : "outline"}
              disabled={disabled || answers === undefined}
              aria-describedby={answers === undefined ? statusId : undefined}
              onClick={() => answers && onChoose?.(option.optionId, answers)}
            >
              {option.name}
            </Button>
          ))
        ) : (
          <Button variant="primary" onClick={() => goTo(current + 1)}>
            Next
          </Button>
        )}
      </div>
    </>
  );
}
