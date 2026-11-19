import { describe, expect, it } from "vitest";
import { INSPECTOR_WIDTH, minInspectorWidth, offeredTabs, shownInspectorWidth } from "../lib/inspector";

describe("the Artifacts tab", () => {
  it("is offered only while the session has an artifact, between Files and Terminal", () => {
    const on = { hasFolder: true, isRepository: true, hasSession: true };
    expect(offeredTabs({ ...on, hasArtifacts: true })).toEqual(["changes", "activity", "files", "artifacts", "terminal"]);
    expect(offeredTabs({ ...on, hasArtifacts: false })).toEqual(["changes", "activity", "files", "terminal"]);
    expect(offeredTabs(on)).toEqual(["changes", "activity", "files", "terminal"]);
  });

  it("shows wide, for its list as for a page, so opening one does not move the edge", () => {
    expect(shownInspectorWidth("artifacts", 380)).toBe(INSPECTOR_WIDTH.wide);
    expect(shownInspectorWidth("artifacts", 640)).toBe(640);
    expect(minInspectorWidth("artifacts")).toBe(INSPECTOR_WIDTH.wide);
  });
});
