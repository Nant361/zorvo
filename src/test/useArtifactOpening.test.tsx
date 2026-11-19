import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useArtifactOpening } from "../hooks/useArtifactOpening";
import type { ShownArtifact, ViewedArtifact } from "../lib/artifacts";

const ARTIFACT = { id: "a-0123456789abcdef", title: "Report", sourcePath: "/w/r.html", versions: [{ n: 1, at: 1, bytes: 1 }] };
const shownOf = (overrides: Partial<ShownArtifact> = {}): ShownArtifact => ({ artifact: ARTIFACT, version: 1, isNewArtifact: true, isNewVersion: true, ...overrides });

function setup(activeSessionId: string | null, viewed: ViewedArtifact | null = null) {
  const showTab = vi.fn();
  const view = vi.fn();
  const { result } = renderHook(() => useArtifactOpening({ activeSessionId, viewed, showTab, view }));
  return { onShown: result.current, showTab, view };
}

describe("when an agent shows a page", () => {
  it("shows the Artifacts tab on a new artifact of the session on screen", () => {
    const env = setup("s-1");
    env.onShown("s-1", shownOf());
    expect(env.showTab).toHaveBeenCalledTimes(1);
    expect(env.view).toHaveBeenCalledWith({ artifactId: ARTIFACT.id, version: null });
  });

  it("moves nothing for another session", () => {
    const env = setup("s-2");
    env.onShown("s-1", shownOf());
    expect(env.showTab).not.toHaveBeenCalled();
    expect(env.view).not.toHaveBeenCalled();
  });

  it("moves nothing for a new version: the viewer follows the newest by itself", () => {
    const env = setup("s-1", { artifactId: ARTIFACT.id, version: null });
    env.onShown("s-1", shownOf({ isNewArtifact: false, version: 2 }));
    expect(env.showTab).not.toHaveBeenCalled();
    expect(env.view).not.toHaveBeenCalled();
  });

  it("moves nothing while no session is on screen", () => {
    const env = setup(null);
    env.onShown("s-1", shownOf());
    expect(env.showTab).not.toHaveBeenCalled();
  });
});
