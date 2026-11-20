import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AgentSessionList } from "../components/workspace/AgentSessionList";

/** The draft's list of the agent's sessions, as the `NewSession` artboard draws it (lines 48–53). */
function renderLoaded() {
  const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  render(
    <AgentSessionList
      agentName="Claude Code"
      state={{
        kind: "loaded",
        sessions: [
          { acpSessionId: "a", title: "Refactor the composer dock", updatedAt: yesterday },
          { acpSessionId: "b", title: "Fix flaky worktree test" },
          { acpSessionId: "c", title: "Draft release notes for 0.8.0" },
        ],
        truncated: false,
        incomplete: false,
      }}
      importError={null}
      onLoad={vi.fn()}
      onImport={vi.fn()}
    />,
  );
}

describe("the agent's sessions", () => {
  it("are headed by whose they are", () => {
    renderLoaded();
    const title = screen.getByRole("heading", { name: "Or continue one of Claude Code's sessions in this folder" });
    expect(title).toHaveClass("text-caption", "font-medium", "text-fg-muted");
    expect(screen.queryByText("3 in this folder")).toBeNull();
  });

  it("are plain 36px rows with a hairline between them and no box on hover", () => {
    renderLoaded();
    const row = screen.getByRole("button", { name: /Refactor the composer dock/ });
    expect(row).toHaveClass("flex", "h-9", "items-center", "gap-3", "text-ui", "text-fg-secondary", "hover:text-fg", "focus-ring");
    expect(row.className).not.toMatch(/hover:bg-/);
    expect(row.closest("li")).toHaveClass("border-b", "border-border", "last:border-b-0");
    expect(within(row).queryByText("Continue")).toBeNull();
    const time = within(row).getByText(/ago|yesterday|1d/i);
    expect(time).toHaveClass("text-caption", "text-fg-muted");
  });
});
