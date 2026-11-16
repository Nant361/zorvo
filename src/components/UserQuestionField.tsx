import { useEffect, useId, useRef, type Ref } from "react";
import type { UserQuestion } from "../types";
import { MAX_OTHER_CHARS, shownLabel, type QuestionDraft } from "../lib/user-questions";
import { INPUT } from "./chat/ElicitationFields";

export interface UserQuestionFieldProps {
  question: UserQuestion;
  draft: QuestionDraft;
  onChange: (draft: QuestionDraft) => void;
  disabled: boolean;
  /** The header above the question; left out when a step already names it. */
  showsHeader: boolean;
  /** Enter in the Other box: what Next or Submit would do. */
  onEnter: () => void;
  /** Takes the focus itself (`tabIndex` -1) when it has no control that can, as in a disabled card. */
  ref?: Ref<HTMLFieldSetElement>;
}

/** A row the whole of which picks the option; the picked one is filled and outlined. */
function rowClass(isPicked: boolean, disabled: boolean): string {
  const state = isPicked ? "border-border-strong bg-chip" : "border-border";
  const pointer = disabled ? "" : isPicked ? "cursor-pointer" : "cursor-pointer hover:bg-chip";
  return `rounded-lg border text-ui transition-colors ${state} ${pointer}`;
}

const ROW_INNER = "flex items-start gap-2.5 px-3 py-[9px]";
const CONTROL = "focus-ring mt-0.5 size-3.5 shrink-0";

interface OptionRowProps {
  type: "radio" | "checkbox";
  name: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}

function OptionRow({ type, name, label, description, checked, disabled, onChange }: OptionRowProps) {
  const { text, isRecommended } = shownLabel(label);
  return (
    <label className={`${ROW_INNER} ${rowClass(checked, disabled)}`}>
      <input type={type} name={name} className={CONTROL} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-fg">
          {text}
          {isRecommended && (
            <span className="rounded-[5px] bg-chip px-1.5 text-caption text-fg-muted ring-1 ring-inset ring-border">
              Recommended
            </span>
          )}
        </span>
        {description && <span className="whitespace-pre-line text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}

/**
 * One of Qwen Code's `ask_user_question` questions: the agent's options (one, or several for a
 * multi-select question) and "Other", whose text box opens once it is picked. Holds no answers;
 * what is typed is never stored or logged.
 */
export function UserQuestionField({ question, draft, onChange, disabled, showsHeader, onEnter, ref }: UserQuestionFieldProps) {
  const name = useId();
  const type = question.multiSelect ? "checkbox" : "radio";
  const boxRef = useRef<HTMLInputElement>(null);
  // Set when Other is picked with the pointer, so the box that opens takes the focus. Not from the
  // keyboard: arrow keys pick Other on their way through a radio group and would be caught in the box.
  const focusBox = useRef(false);
  const isPointerPick = useRef(false);

  useEffect(() => {
    if (focusBox.current && draft.otherChecked) boxRef.current?.focus();
    focusBox.current = false;
  }, [draft.otherChecked]);

  const toggle = (label: string) =>
    onChange(
      question.multiSelect
        ? { ...draft, picked: draft.picked.includes(label) ? draft.picked.filter((l) => l !== label) : [...draft.picked, label] }
        : { ...draft, picked: [label], otherChecked: false },
    );
  const toggleOther = () => {
    focusBox.current = !draft.otherChecked && isPointerPick.current;
    isPointerPick.current = false;
    onChange(question.multiSelect ? { ...draft, otherChecked: !draft.otherChecked } : { ...draft, picked: [], otherChecked: true });
  };
  // Typing an answer picks "Other"; for a single choice it replaces the option picked.
  const typeOther = (otherText: string) =>
    onChange(question.multiSelect ? { ...draft, otherChecked: true, otherText } : { picked: [], otherChecked: true, otherText });

  return (
    <fieldset ref={ref} tabIndex={-1} className="flex min-w-0 flex-col gap-1.5 focus:outline-none">
      <legend className="mb-1.5 flex flex-col gap-0.5">
        {showsHeader && question.header && <span className="text-caption font-medium text-fg-muted">{question.header}</span>}
        <span className="whitespace-pre-line text-ui font-semibold text-fg">{question.question}</span>
        {question.multiSelect && <span className="text-ui text-fg-muted">Pick all that apply.</span>}
      </legend>
      {question.options.map((option) => (
        <OptionRow
          key={option.label}
          type={type}
          name={name}
          label={option.label}
          description={option.description}
          checked={draft.picked.includes(option.label)}
          disabled={disabled}
          onChange={() => toggle(option.label)}
        />
      ))}
      {/* One element whether or not Other is picked, so its control keeps the focus while the box opens. */}
      <div className={rowClass(draft.otherChecked, disabled)}>
        <label
          className={`${ROW_INNER} ${disabled ? "" : "cursor-pointer"}`}
          onPointerDown={() => {
            isPointerPick.current = true;
          }}
        >
          <input
            type={type}
            name={name}
            className={CONTROL}
            checked={draft.otherChecked}
            disabled={disabled}
            onChange={toggleOther}
            onKeyDown={() => {
              isPointerPick.current = false;
            }}
          />
          <span className="text-fg">Other</span>
        </label>
        {draft.otherChecked && (
          <div className="pr-3 pb-3 pl-9">
            <input
              ref={boxRef}
              type="text"
              className={INPUT}
              // The fieldset's legend already names the question; only one question shows at a time.
              aria-label="Your own answer"
              placeholder="Type your own answer"
              maxLength={MAX_OTHER_CHARS}
              value={draft.otherText}
              disabled={disabled}
              onChange={(e) => typeOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onEnter();
                }
              }}
            />
          </div>
        )}
      </div>
    </fieldset>
  );
}
