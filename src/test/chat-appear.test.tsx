import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatCanvas, type ChatMessage } from "../components/ChatCanvas";
import type { ActionCard } from "../types";

const APPEAR = "motion-safe:animate-appear";

const message = (id: string, role: ChatMessage["role"] = "agent"): ChatMessage => ({
  id,
  role,
  content: `text of ${id}`,
  timestamp: 1,
  isComplete: true,
});

const row = (id: string) => screen.getByTestId(`chat-message-${id}`);

const card: ActionCard = {
  id: "c-1",
  sessionId: "s-1",
  title: "Permission requested",
  prompt: "Edit src/main.ts",
  status: "pending",
  timestamp: 1,
  requestId: 1,
  options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
};

describe("what fades in", () => {
  it("fades in a message that arrives while the chat is on screen, not the history it opened with", () => {
    const history = [message("m-1", "user"), message("m-2")];
    const view = render(<ChatCanvas conversationId="a" messages={history} />);
    expect(row("m-1")).not.toHaveClass(APPEAR);
    expect(row("m-2")).not.toHaveClass(APPEAR);

    view.rerender(<ChatCanvas conversationId="a" messages={[...history, message("m-3", "user")]} />);

    expect(row("m-3")).toHaveClass(APPEAR);
    expect(row("m-2")).not.toHaveClass(APPEAR);
  });

  it("fades nothing in when another conversation is shown", () => {
    const view = render(<ChatCanvas conversationId="a" messages={[message("m-1")]} />);

    view.rerender(<ChatCanvas conversationId="b" messages={[message("n-1", "user"), message("n-2")]} />);

    expect(row("n-1")).not.toHaveClass(APPEAR);
    expect(row("n-2")).not.toHaveClass(APPEAR);
  });

  it("does not fade in a transcript that loads into an empty chat, but does fade a first message", () => {
    const loading = render(<ChatCanvas conversationId="a" messages={[]} />);
    loading.rerender(<ChatCanvas conversationId="a" messages={[message("m-1", "user"), message("m-2")]} />);
    expect(row("m-1")).not.toHaveClass(APPEAR);
    expect(row("m-2")).not.toHaveClass(APPEAR);
    loading.unmount();

    const fresh = render(<ChatCanvas conversationId="b" messages={[]} />);
    fresh.rerender(<ChatCanvas conversationId="b" messages={[message("n-1", "user")]} />);
    expect(row("n-1")).toHaveClass(APPEAR);
    // The reply that follows still fades in: the chat already showed a message of its own.
    fresh.rerender(<ChatCanvas conversationId="b" messages={[message("n-1", "user"), message("n-2")]} />);
    expect(row("n-1")).toHaveClass(APPEAR);
    expect(row("n-2")).toHaveClass(APPEAR);
  });

  it("fades in a permission card that lands on a reply already on screen, once", () => {
    const reply = { ...message("m-1"), isComplete: false };
    const view = render(<ChatCanvas conversationId="a" messages={[reply]} isWorking />);

    view.rerender(<ChatCanvas conversationId="a" messages={[{ ...reply, actionCard: card }]} isWorking />);

    expect(row("m-1")).not.toHaveClass(APPEAR);
    expect(screen.getByTestId("action-card-c-1").parentElement).toHaveClass(APPEAR);
  });
});
