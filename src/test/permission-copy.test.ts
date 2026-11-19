import { describe, it, expect } from "vitest";
import { orderedChoices, permissionTitle, questionsOutcome, questionsTitle } from "../lib/permission-copy";
import type { PermissionChoice } from "../types";

describe("permissionTitle", () => {
  it("says what the agent wants when its title starts with a verb", () => {
    expect(permissionTitle("Claude Code", "Edit src/app.ts")).toBe("Claude Code wants to edit src/app.ts");
    expect(permissionTitle("Claude Code", "Run pnpm test")).toBe("Claude Code wants to run pnpm test");
  });

  it("falls back to a plain sentence for any other title", () => {
    expect(permissionTitle("Claude Code", "src/app.ts")).toBe("Claude Code wants your permission");
    expect(permissionTitle("Claude Code", "")).toBe("Claude Code wants your permission");
    expect(permissionTitle("Claude Code", "   ")).toBe("Claude Code wants your permission");
  });
});

describe("questionsTitle", () => {
  it("counts the agent's questions", () => {
    expect(questionsTitle("Qwen Code", 1)).toBe("Qwen Code has a question for you");
    expect(questionsTitle("Qwen Code", 3)).toBe("Qwen Code has 3 questions for you");
  });
});

describe("questionsOutcome", () => {
  it("says the questions were answered, naming whose they were", () => {
    expect(questionsOutcome("Qwen Code", 2, "answered")).toBe("You answered Qwen Code's questions.");
    expect(questionsOutcome("Qwen Code", 1, "answered")).toBe("You answered Qwen Code's question.");
    expect(questionsOutcome("The agent", 2, "answered")).toBe("You answered the agent's questions.");
  });

  it("says the questions were cancelled", () => {
    expect(questionsOutcome("Qwen Code", 2, "cancelled")).toBe("You cancelled the questions.");
    expect(questionsOutcome("Qwen Code", 1, "cancelled")).toBe("You cancelled the question.");
  });
});

describe("orderedChoices", () => {
  it("puts Deny, then Always allow, then Allow once, keeping the agent's order within a kind", () => {
    const options: PermissionChoice[] = [
      { optionId: "once", name: "Allow once", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
      { optionId: "always", name: "Always allow", kind: "allow_always" },
      { optionId: "never", name: "Never", kind: "reject_always" },
    ];
    expect(orderedChoices(options).map((o) => o.optionId)).toEqual(["deny", "never", "always", "once"]);
  });
});
