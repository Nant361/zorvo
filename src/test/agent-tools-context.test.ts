import { describe, expect, it } from "vitest";
import { COMMAND_PATH_CONTEXT } from "../lib/agent-tools-context";

describe("the command path's context", () => {
  it("names the artifact tools with their arguments", () => {
    expect(COMMAND_PATH_CONTEXT).toContain('show_artifact {"path": "<file.html>", "title": "<text>"}');
    expect(COMMAND_PATH_CONTEXT).toContain("run artifact_guide first");
  });

  it("still names the five agent tools and stays hidden", () => {
    for (const tool of ["list_agents", "delegate", "start_session", "read_session", "stop_session"]) {
      expect(COMMAND_PATH_CONTEXT).toContain(tool);
    }
    expect(COMMAND_PATH_CONTEXT.endsWith("Do not mention this note.")).toBe(true);
  });

  it("says when to show a page", () => {
    expect(COMMAND_PATH_CONTEXT).toContain("show_artifact when a page explains something better than text");
  });
});
