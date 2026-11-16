import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ActionCard } from "../components/ActionCard";
import { applyPermissionRequest } from "../lib/acp-events";
import {
  EMPTY_DRAFT,
  MAX_OTHER_CHARS,
  answerOf,
  answersOf,
  parseUserQuestions,
  shownLabel,
  submitHint,
  usableQuestions,
} from "../lib/user-questions";
import type { ActionCard as ActionCardType, UserQuestion } from "../types";

const COLOURS = {
  question: "Which colours do you like?",
  header: "Colours",
  options: [{ label: "Blue", description: "Like the sea" }, { label: "Green" }],
  multiSelect: true,
};
const EDITOR = {
  question: "Which editor do you use?",
  header: "Editor",
  options: [{ label: "Vim" }, { label: "Zed", description: "Fast" }],
  multiSelect: false,
};

/** What Qwen Code sends for ask_user_question: the questions in `_meta` and in `rawInput`. */
function qwenToolCall(questions: unknown[] = [COLOURS, EDITOR], meta: Record<string, unknown> = {}) {
  return {
    toolCallId: "t-ask",
    title: "Ask user 2 questions",
    kind: "other",
    rawInput: { questions },
    _meta: { toolName: "ask_user_question", qwenInteractionKind: "user_question", qwenQuestions: questions, ...meta },
  };
}

const OPTIONS = [
  { optionId: "proceed_once", name: "Submit", kind: "allow_once" },
  { optionId: "cancel", name: "Cancel", kind: "reject_once" },
];

function questionCard(overrides: Partial<ActionCardType> = {}): ActionCardType {
  return {
    id: "act-1",
    sessionId: "s-1",
    title: "Permission requested",
    prompt: "Ask user 2 questions",
    status: "pending",
    timestamp: 1,
    options: OPTIONS,
    requestId: "ask-1",
    questions: parseUserQuestions(qwenToolCall()),
    ...overrides,
  };
}

const ctx = () => ({ sessionId: "s-1", now: 1, createId: (prefix: string) => `${prefix}-1` });

describe("parseUserQuestions", () => {
  it("reads the questions of an ask_user_question request", () => {
    expect(parseUserQuestions(qwenToolCall())).toEqual([COLOURS, EDITOR]);
  });

  it("defaults a missing header and multiSelect", () => {
    const parsed = parseUserQuestions(qwenToolCall([{ question: "Pick one?", options: [{ label: "A" }, { label: "B" }] }]));

    expect(parsed).toEqual([{ question: "Pick one?", header: "", options: [{ label: "A" }, { label: "B" }], multiSelect: false }]);
  });

  it("is not a question request without the Qwen marker", () => {
    expect(parseUserQuestions({ title: "Run it" })).toBeUndefined();
    expect(parseUserQuestions(null)).toBeUndefined();
    expect(parseUserQuestions(qwenToolCall([COLOURS], { qwenInteractionKind: "plan" }))).toBeUndefined();
    const { _meta, ...withoutMeta } = qwenToolCall();
    expect(_meta).toBeDefined();
    expect(parseUserQuestions(withoutMeta)).toBeUndefined();
  });

  it.each([
    ["no questions", []],
    ["five questions", Array.from({ length: 5 }, () => COLOURS)],
    ["a question that is not an object", ["Which?"]],
    ["a question without text", [{ ...COLOURS, question: "  " }]],
    ["one option only", [{ ...COLOURS, options: [{ label: "Blue" }] }]],
    ["five options", [{ ...COLOURS, options: ["a", "b", "c", "d", "e"].map((label) => ({ label })) }]],
    ["an option without a label", [{ ...COLOURS, options: [{ label: "Blue" }, { description: "x" }] }]],
    ["the same label twice", [{ ...COLOURS, options: [{ label: "Blue" }, { label: "Blue" }] }]],
    ["a multiSelect that is not a boolean", [{ ...COLOURS, multiSelect: "yes" }]],
    ["one good and one bad question", [COLOURS, { question: "x" }]],
  ])("does not parse %s", (_name, questions) => {
    expect(parseUserQuestions(qwenToolCall(questions))).toBeUndefined();
  });

  it("does not parse questions that are not a list", () => {
    expect(parseUserQuestions(qwenToolCall([], { qwenQuestions: "nope" }))).toBeUndefined();
  });

  it("shows control characters and hidden marks as visible escapes, and cuts long text", () => {
    const parsed = parseUserQuestions(
      qwenToolCall([
        { question: "Run\u202Eevil?", header: "H", options: [{ label: "A\u0007" }, { label: "x".repeat(500) }], multiSelect: false },
      ]),
    )!;

    expect(parsed[0].question).toBe("Run\\u202Eevil?");
    expect(parsed[0].options[0].label).toBe("A\\u0007");
    expect(parsed[0].options[1].label).toHaveLength(200);
  });
});

describe("text from the agent", () => {
  it("keeps the line breaks of a question and a description, and escapes every other hidden character", () => {
    const parsed = parseUserQuestions(
      qwenToolCall([
        { question: "First line\nSecond\u202Eline", options: [{ label: "A", description: "one\r\ntwo" }, { label: "B" }] },
      ]),
    )!;

    expect(parsed[0].question).toBe("First line\nSecond\\u202Eline");
    expect(parsed[0].options[0].description).toBe("one\ntwo");
  });

  it("cuts at a whole character, so no half of a surrogate pair is left to break the JSON", () => {
    const label = "x".repeat(198) + "😀".repeat(5);
    const parsed = parseUserQuestions(qwenToolCall([{ question: "Q?", options: [{ label }, { label: "B" }] }]))!;

    expect(parsed[0].options[0].label).toBe("x".repeat(198) + "😀…");
    expect(() => encodeURIComponent(parsed[0].options[0].label)).not.toThrow();
  });
});

describe("usableQuestions", () => {
  it("accepts what parseUserQuestions makes", () => {
    const parsed = parseUserQuestions(qwenToolCall());

    expect(usableQuestions(parsed)).toBe(parsed);
  });

  it.each([
    ["nothing", undefined],
    ["not a list", { question: "x" }],
    ["an empty list", []],
    ["five questions", Array.from({ length: 5 }, () => EDITOR)],
    ["a question without options", [{ ...EDITOR, options: undefined }]],
    ["a question with no options", [{ ...EDITOR, options: [] }]],
    ["an option that is a string", [{ ...EDITOR, options: ["Vim"] }]],
    ["a question without a header", [{ question: "x", options: [{ label: "A" }], multiSelect: false }]],
    ["a multiSelect that is not a boolean", [{ ...EDITOR, multiSelect: 1 }]],
  ])("rejects damaged questions: %s", (_name, saved) => {
    expect(usableQuestions(saved)).toBeUndefined();
  });
});

describe("answers", () => {
  const [colours, editor] = parseUserQuestions(qwenToolCall()) as UserQuestion[];

  it("is the picked option of a single-choice question", () => {
    expect(answerOf(editor, { ...EMPTY_DRAFT, picked: ["Zed"] })).toBe("Zed");
  });

  it("joins the picks of a multi-select question with a comma, in the order of the options", () => {
    expect(answerOf(colours, { ...EMPTY_DRAFT, picked: ["Green", "Blue"] })).toBe("Blue, Green");
  });

  it("is the typed text when Other is chosen, and adds it to the picks of a multi-select question", () => {
    expect(answerOf(editor, { picked: ["Vim"], otherChecked: true, otherText: "  Helix " })).toBe("Helix");
    expect(answerOf(colours, { picked: ["Blue"], otherChecked: true, otherText: "Red" })).toBe("Blue, Red");
  });

  it("has no answer while nothing is picked or Other is empty", () => {
    expect(answerOf(editor, EMPTY_DRAFT)).toBeUndefined();
    expect(answerOf(editor, { picked: [], otherChecked: true, otherText: "   " })).toBeUndefined();
    expect(answerOf(colours, { picked: ["Blue"], otherChecked: false, otherText: "ignored" })).toBe("Blue");
  });

  it("builds the answers by question number once every question has one", () => {
    expect(answersOf([colours, editor], [{ ...EMPTY_DRAFT, picked: ["Blue"] }])).toBeUndefined();
    expect(answersOf([colours, editor], [{ ...EMPTY_DRAFT, picked: ["Blue"] }, { ...EMPTY_DRAFT, picked: ["Vim"] }])).toEqual({
      "0": "Blue",
      "1": "Vim",
    });
  });
});

describe("a permission request that asks questions", () => {
  const request = {
    requestId: "ask-1",
    toolCall: qwenToolCall(),
    options: OPTIONS,
  };

  it("becomes a card with the questions and the agent's own options", () => {
    const card = applyPermissionRequest([], request, ctx())[0].actionCard!;

    expect(card.questions).toEqual([COLOURS, EDITOR]);
    expect(card.options?.map((o) => o.optionId)).toEqual(["proceed_once", "cancel"]);
    expect(card.prompt).toBe("Ask user 2 questions");
  });

  it("stays a plain card when the questions do not parse", () => {
    const card = applyPermissionRequest([], { ...request, toolCall: qwenToolCall([{ question: "x" }]) }, ctx())[0].actionCard!;

    expect(card.questions).toBeUndefined();
    expect(card.options).toHaveLength(2);
  });

  it("does not turn another tool's request into questions", () => {
    const card = applyPermissionRequest([], { ...request, toolCall: { title: "Run it", rawInput: { questions: [COLOURS] } } }, ctx())[0].actionCard!;

    expect(card.questions).toBeUndefined();
  });
});

describe("shownLabel", () => {
  it("takes the agent's (Recommended) mark off the label and says it was there", () => {
    expect(shownLabel("Local dir /data (Recommended)")).toEqual({ text: "Local dir /data", isRecommended: true });
    expect(shownLabel("Vim (recommended)")).toEqual({ text: "Vim", isRecommended: true });
  });

  it("leaves any other label as it is", () => {
    expect(shownLabel("GCS bucket")).toEqual({ text: "GCS bucket", isRecommended: false });
    expect(shownLabel("(Recommended) first")).toEqual({ text: "(Recommended) first", isRecommended: false });
    expect(shownLabel("(Recommended)")).toEqual({ text: "(Recommended)", isRecommended: false });
  });
});

describe("submitHint", () => {
  const [colours, editor] = parseUserQuestions(qwenToolCall()) as UserQuestion[];
  const unnamed = { ...editor, header: "" };

  it("names the questions still open, by header or by number", () => {
    expect(submitHint([colours, editor], [])).toBe("Answer Colours and Editor to submit.");
    expect(submitHint([colours, editor], [{ ...EMPTY_DRAFT, picked: ["Blue"] }])).toBe("Answer Editor to submit.");
    expect(submitHint([colours, unnamed, editor], [])).toBe("Answer Colours, Question 2 and Editor to submit.");
  });

  it("speaks of the question when there is only one", () => {
    expect(submitHint([editor], [])).toBe("Answer the question to submit.");
  });

  it("has nothing to say once every question has an answer", () => {
    expect(submitHint([editor], [{ ...EMPTY_DRAFT, picked: ["Vim"] }])).toBeUndefined();
  });
});

describe("ActionCard with questions", () => {
  const colours = () => screen.getByRole("group", { name: /Which colours/ });
  const editor = () => screen.getByRole("group", { name: /Which editor/ });
  const submit = () => screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
  const next = () => screen.getByRole("button", { name: "Next" });
  const steps = () => screen.getByRole("list", { name: "Questions" });
  const step = (name: string | RegExp) => within(steps()).getByRole("button", { name });

  it("shows one question at a time, under a step for each question", () => {
    render(<ActionCard card={questionCard()} agentName="Qwen Code" onChoose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Qwen Code has 2 questions for you" })).toBeDefined();
    expect(screen.queryByText("Ask user 2 questions")).toBeNull();
    expect(step("Colours").getAttribute("aria-current")).toBe("step");
    expect(step("Editor").getAttribute("aria-current")).toBeNull();
    expect(within(colours()).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(colours()).getByText("Like the sea")).toBeDefined();
    expect(within(colours()).getByText("Pick all that apply.")).toBeDefined();
    expect(screen.queryByRole("group", { name: /Which editor/ })).toBeNull();
    expect(screen.getByText("Question 1 of 2")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("moves between the questions with Next, Back and the steps, and puts focus in the question shown", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} />);

    fireEvent.click(next());
    expect(within(editor()).getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByRole("group", { name: /Which colours/ })).toBeNull();
    expect(step("Editor").getAttribute("aria-current")).toBe("step");
    expect(document.activeElement).toBe(within(editor()).getByRole("radio", { name: "Vim" }));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(colours()).toBeDefined();
    expect(document.activeElement).toBe(within(colours()).getByRole("checkbox", { name: /Blue/ }));

    fireEvent.click(step("Editor"));
    expect(editor()).toBeDefined();
  });

  it("holds Submit back on the last step and names the questions still open", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} />);
    fireEvent.click(next());

    expect(submit().disabled).toBe(true);
    const hint = screen.getByText("Answer Colours and Editor to submit.");
    expect(submit().getAttribute("aria-describedby")).toBe(hint.id);

    fireEvent.click(within(editor()).getByRole("radio", { name: /Zed/ }));
    expect(screen.getByText("Answer Colours to submit.")).toBeDefined();
    expect(step("Editor (answered)")).toBeDefined();
    expect(submit().disabled).toBe(true);
  });

  it("offers Submit on any step once every question has an answer", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} />);
    fireEvent.click(next());
    fireEvent.click(within(editor()).getByRole("radio", { name: /Zed/ }));
    fireEvent.click(step(/Colours/));

    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));

    expect(submit().disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByText("Question 1 of 2")).toBeDefined();
  });

  it("sends the answers with Submit", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={questionCard()} onChoose={onChoose} />);

    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Green/ }));
    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));
    fireEvent.click(next());
    fireEvent.click(within(editor()).getByRole("radio", { name: /Vim/ }));
    fireEvent.click(within(editor()).getByRole("radio", { name: /Zed/ }));
    fireEvent.click(submit());

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith("proceed_once", { "0": "Blue, Green", "1": "Zed" });
  });

  it("opens a box for Other only once Other is picked, and puts focus in it", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={questionCard()} onChoose={onChoose} />);
    expect(within(colours()).queryByRole("textbox")).toBeNull();

    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));
    fireEvent.click(within(colours()).getByRole("checkbox", { name: "Other" }));
    const box = within(colours()).getByRole("textbox", { name: "Other answer for Colours" });
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute("maxlength")).toBe(String(MAX_OTHER_CHARS));
    fireEvent.change(box, { target: { value: "Red" } });

    fireEvent.click(next());
    fireEvent.click(within(editor()).getByRole("radio", { name: /Vim/ }));
    fireEvent.click(within(editor()).getByRole("radio", { name: "Other" }));
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Other answer for Editor" }), { target: { value: "Helix" } });
    expect((within(editor()).getByRole("radio", { name: /Vim/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(submit());

    expect(onChoose).toHaveBeenCalledWith("proceed_once", { "0": "Blue, Red", "1": "Helix" });
  });

  it("keeps what was typed for Other when you leave the question and come back", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} />);
    fireEvent.click(within(colours()).getByRole("checkbox", { name: "Other" }));
    fireEvent.change(within(colours()).getByRole("textbox"), { target: { value: "Red" } });

    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect((within(colours()).getByRole("textbox") as HTMLInputElement).value).toBe("Red");
  });

  it("needs words for Other: an empty one is no answer", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} />);

    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));
    fireEvent.click(next());
    fireEvent.click(within(editor()).getByRole("radio", { name: "Other" }));

    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Answer Editor to submit.")).toBeDefined();
  });

  it("shows the agent's recommendation as a badge, and still sends the label as the agent wrote it", () => {
    const onChoose = vi.fn();
    const questions = parseUserQuestions(qwenToolCall([{ ...EDITOR, options: [{ label: "Vim (Recommended)" }, { label: "Zed" }] }]));
    render(<ActionCard card={questionCard({ questions })} onChoose={onChoose} />);

    expect(within(editor()).getByText("Recommended")).toBeDefined();
    expect(within(editor()).queryByText(/\(Recommended\)/)).toBeNull();
    fireEvent.click(within(editor()).getByRole("radio", { name: /Vim/ }));
    fireEvent.click(submit());

    expect(onChoose).toHaveBeenCalledWith("proceed_once", { "0": "Vim (Recommended)" });
  });

  it("asks a single question without steps, with its header above it", () => {
    render(<ActionCard card={questionCard({ questions: parseUserQuestions(qwenToolCall([EDITOR])) })} agentName="Qwen Code" onChoose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Qwen Code has a question for you" })).toBeDefined();
    expect(screen.queryByRole("list", { name: "Questions" })).toBeNull();
    expect(within(editor()).getByText("Editor")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Answer the question to submit.")).toBeDefined();
  });

  it("declines with Cancel, without answers, even when nothing is answered", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={questionCard()} onChoose={onChoose} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChoose).toHaveBeenCalledWith("cancel");
  });

  it("keeps what was picked when the answer did not go through and the card is asked again", () => {
    const { rerender } = render(<ActionCard card={questionCard()} agentName="Qwen Code" onChoose={() => {}} />);
    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));
    fireEvent.click(next());
    fireEvent.click(within(editor()).getByRole("radio", { name: /Zed/ }));

    rerender(<ActionCard card={questionCard({ status: "approved", chosenOptionId: "proceed_once" })} agentName="Qwen Code" onChoose={() => {}} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByText("You answered Qwen Code's questions.")).toBeDefined();

    rerender(<ActionCard card={questionCard()} agentName="Qwen Code" onChoose={() => {}} />);
    expect((within(colours()).getByRole("checkbox", { name: /Blue/ }) as HTMLInputElement).checked).toBe(true);
    expect(submit().disabled).toBe(false);
  });

  it("disables the answers while the card is disabled, and still lets you read every question", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} disabled />);

    expect((within(colours()).getByRole("checkbox", { name: /Blue/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(next());
    expect((within(editor()).getByRole("radio", { name: /Vim/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it("says how a settled card ended, with none of the answers", () => {
    const { rerender } = render(<ActionCard card={questionCard({ status: "rejected", chosenOptionId: "cancel" })} agentName="Qwen Code" />);

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByText("Waiting for you")).toBeNull();
    expect(screen.getByText("You cancelled the questions.")).toBeDefined();

    rerender(<ActionCard card={questionCard({ status: "rejected" })} agentName="Qwen Code" />);
    expect(screen.getByText("This request was not answered.")).toBeDefined();
  });

  it("is a plain card when it has no allowing option to send the answers with", () => {
    render(<ActionCard card={questionCard({ options: [OPTIONS[1]] })} onChoose={() => {}} />);

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("is a plain card when the questions saved on it are damaged", () => {
    const onChoose = vi.fn();
    const damaged = [{ question: "Which?" }] as unknown as UserQuestion[];
    render(<ActionCard card={questionCard({ questions: damaged })} onChoose={onChoose} />);

    expect(screen.queryByRole("group")).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it("is a plain card without questions", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={questionCard({ questions: undefined })} onChoose={onChoose} />);

    expect(screen.queryByRole("group")).toBeNull();
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    expect(onChoose).toHaveBeenCalledWith("proceed_once");
  });
});
