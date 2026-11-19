import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useInspector } from "../hooks/useInspector";
import type { InspectorTab } from "../lib/inspector";

const OFFERED: readonly InspectorTab[] = ["activity", "files", "artifacts", "terminal"];
const PAGE = { artifactId: "a-0123456789abcdef", version: null };

function renderInspector() {
  return renderHook(
    ({ view }: { view: string }) =>
      useInspector("/Users/test/zorvo", false, 0, vi.fn(), { isSidebarShown: true, offered: OFFERED, view, onCrowded: vi.fn() }),
    { initialProps: { view: "s-a" } },
  );
}

describe("the artifact open in the inspector", () => {
  it("expands only while an artifact is open: going back to the list gives the chat back", () => {
    const { result } = renderInspector();
    act(() => result.current.show("artifacts"));
    act(() => result.current.viewArtifact(PAGE));
    act(() => result.current.setArtifactExpanded(true));
    expect(result.current.isArtifactExpanded).toBe(true);

    // Deleting the expanded artifact returns to the list, which has no Shrink of its own.
    act(() => result.current.viewArtifact(null));

    expect(result.current.viewedArtifact).toBeNull();
    expect(result.current.isArtifactExpanded).toBe(false);
  });

  it("stays expanded when another version or artifact is opened", () => {
    const { result } = renderInspector();
    act(() => result.current.show("artifacts"));
    act(() => result.current.viewArtifact(PAGE));
    act(() => result.current.setArtifactExpanded(true));

    act(() => result.current.viewArtifact({ ...PAGE, version: 1 }));

    expect(result.current.isArtifactExpanded).toBe(true);
  });

  it("belongs to the view it was opened for", () => {
    const { result, rerender } = renderInspector();
    act(() => result.current.show("artifacts"));
    act(() => result.current.viewArtifact(PAGE, "s-b"));
    expect(result.current.viewedArtifact).toBeNull();

    rerender({ view: "s-b" });

    expect(result.current.viewedArtifact).toEqual(PAGE);
  });
});
