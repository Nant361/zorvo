import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ArtifactsPanel, type ArtifactsPanelProps } from "../components/artifacts/ArtifactsPanel";
import { fakeTauriInvoke } from "./setup";
import { formatShortTime } from "../lib/relative-time";
import type { Artifact } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const REPORT: Artifact = {
  id: "a-0123456789abcdef",
  title: "Session list performance",
  sourcePath: "/w/report.html",
  versions: [
    { n: 1, at: 1_000, bytes: 10 },
    { n: 2, at: 2_000, bytes: 11 },
    { n: 3, at: 3_000, bytes: 12 },
  ],
};
const STEPS: Artifact = { id: "a-1111111111111111", title: "Render steps", sourcePath: "/w/steps.html", versions: [{ n: 1, at: 500, bytes: 5 }] };
const RECT = { x: 880, y: 104, width: 540, height: 700 };

let spy: ReturnType<typeof vi.spyOn>;
const calls = (cmd: string) => spy.mock.calls.filter(([name]: unknown[]) => name === cmd).map(([, args]: unknown[]) => args);

beforeEach(() => {
  spy = vi.spyOn(internals(), "invoke");
  spy.mockClear();
  spy.mockImplementation((cmd: string, args?: Record<string, unknown>) => fakeTauriInvoke(cmd, args));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function show(overrides: Partial<ArtifactsPanelProps> = {}) {
  const props: ArtifactsPanelProps = {
    sessionId: "s-1",
    artifacts: [REPORT, STEPS],
    viewed: null,
    onView: vi.fn(),
    isExpanded: false,
    onToggleExpanded: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ArtifactsPanel {...props} />) };
}

const viewingReport = { viewed: { artifactId: REPORT.id, version: null } };

describe("the list", () => {
  it("lists a session's artifacts and opens one", () => {
    const { props } = show();

    expect(screen.getByRole("button", { name: /Session list performance/ }).textContent).toContain("Version 3");
    fireEvent.click(screen.getByRole("button", { name: /Render steps/ }));

    expect(props.onView).toHaveBeenCalledWith({ artifactId: STEPS.id, version: null });
    expect(calls("artifact_view_show")).toEqual([]);
  });

  it("opens straight on the page when the session has one artifact", async () => {
    show({ artifacts: [REPORT] });

    expect(screen.getByRole("heading", { name: "Session list performance" })).toBeTruthy();
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Back to artifacts" })).toBeNull();
  });
});

describe("the viewer", () => {
  it("asks the backend to show the page in its box, with ids and a rectangle only", async () => {
    const { container } = show(viewingReport);

    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    expect(calls("artifact_view_show")[0]).toEqual({ sessionId: "s-1", artifactId: REPORT.id, version: 3, ...RECT });
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("img", { name: "Session list performance" })).toBeTruthy();
  });

  it("goes back to the list", () => {
    const { props } = show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "Back to artifacts" }));
    expect(props.onView).toHaveBeenCalledWith(null);
  });

  it("hides the page while the version menu is open, and picks a version from it", async () => {
    const { props } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Version 3 of 3" }));

    await waitFor(() => expect(calls("artifact_view_hide")).toContainEqual({ hidden: true }));
    const menu = screen.getByRole("menu", { name: "Versions" });
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(3);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Version 1/ }));
    expect(props.onView).toHaveBeenCalledWith({ artifactId: REPORT.id, version: 1 });
    await waitFor(() => expect(calls("artifact_view_hide").at(-1)).toEqual({ hidden: false }));
  });

  it("dates each version in the short form, so its name is never cut", () => {
    show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "Version 3 of 3" }));
    const rows = within(screen.getByRole("menu", { name: "Versions" })).getAllByRole("menuitemradio");
    expect(rows[0].textContent).toBe(`Version 3${formatShortTime(3_000)} · newest`);
    expect(rows[2].textContent).toBe(`Version 1${formatShortTime(1_000)}`);
  });

  it("picking the newest version follows it again", () => {
    const { props } = show({ viewed: { artifactId: REPORT.id, version: 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Version 1 of 3" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Version 3/ }));
    expect(props.onView).toHaveBeenCalledWith({ artifactId: REPORT.id, version: null });
  });

  it("marks an older version and shows that version", async () => {
    show({ viewed: { artifactId: REPORT.id, version: 2 } });

    expect(screen.getByText("Older version")).toBeTruthy();
    await waitFor(() => expect(calls("artifact_view_show")[0]).toMatchObject({ version: 2 }));
  });

  it("shows a new version in place while it follows the newest", async () => {
    const { props, rerender } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    const next = { ...REPORT, versions: [...REPORT.versions, { n: 4, at: 4_000, bytes: 13 }] };

    rerender(<ArtifactsPanel {...props} artifacts={[next, STEPS]} />);

    await waitFor(() => expect(calls("artifact_view_show").at(-1)).toMatchObject({ version: 4 }));
  });

  it("keeps a pinned older version when a new one arrives", async () => {
    const { props, rerender } = show({ viewed: { artifactId: REPORT.id, version: 2 } });
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    const next = { ...REPORT, versions: [...REPORT.versions, { n: 4, at: 4_000, bytes: 13 }] };

    rerender(<ArtifactsPanel {...props} artifacts={[next, STEPS]} />);
    await act(async () => {});

    expect(calls("artifact_view_show")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Version 2 of 4" })).toBeTruthy();
  });

  it("makes a new view on Reload", async () => {
    show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(2));
  });

  it("says a pruned version is gone and asks for no page", async () => {
    show({ viewed: { artifactId: REPORT.id, version: 9 } });

    expect(screen.getByText("This version is no longer on this Mac.")).toBeTruthy();
    await act(async () => {});
    expect(calls("artifact_view_show")).toEqual([]);
  });

  it("closes the view when it goes away", async () => {
    const { unmount } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    unmount();
    await waitFor(() => expect(calls("artifact_view_close")).toHaveLength(1));
  });

  it("offers Expand beside the chat and Shrink in its place", () => {
    const { props, rerender } = show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(props.onToggleExpanded).toHaveBeenCalledTimes(1);

    rerender(<ArtifactsPanel {...props} isExpanded />);

    expect(screen.getByRole("button", { name: "Shrink" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to artifacts" })).toBeNull();
  });

  it("tells the user when the page cannot be shown", async () => {
    spy.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
      cmd === "artifact_view_show" ? Promise.reject("Zorvo could not show that page.") : fakeTauriInvoke(cmd, args),
    );
    const { props } = show(viewingReport);
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith("Zorvo could not show that page."));
  });
});

describe("a box that has no size yet", () => {
  const zero = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  const sized = { ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) };

  it("asks for the page only once the box shows (Settings and the gallery hide it without unmounting)", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(zero);
    show(viewingReport);
    await act(async () => {});
    expect(calls("artifact_view_show")).toEqual([]);

    rect.mockReturnValue(sized);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    expect(calls("artifact_view_show")[0]).toMatchObject({ version: 3, ...RECT });
  });

  it("asks for a new version that arrived while the box was hidden, when it shows again", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(sized);
    const { props, rerender } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));

    rect.mockReturnValue(zero);
    const next = { ...REPORT, versions: [...REPORT.versions, { n: 4, at: 4_000, bytes: 13 }] };
    rerender(<ArtifactsPanel {...props} artifacts={[next, STEPS]} />);
    await act(async () => {});
    expect(calls("artifact_view_show")).toHaveLength(1);

    rect.mockReturnValue(sized);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(calls("artifact_view_show").at(-1)).toMatchObject({ version: 4 }));
  });
});

describe("one viewer leaving as another arrives", () => {
  it("keeps the page when the same one moves to another box, as Expand and Shrink do", async () => {
    const first = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));

    // Expand: the viewer beside the chat leaves and the one in the chat's place arrives, in one step.
    first.unmount();
    show({ ...viewingReport, isExpanded: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // The page is moved, not made again: what was typed or scrolled in it stays.
    expect(calls("artifact_view_show")).toHaveLength(1);
    expect(calls("artifact_view_close")).toEqual([]);
    expect(calls("artifact_view_bounds")).toContainEqual(RECT);
    expect(calls("artifact_view_hide").at(-1)).toEqual({ hidden: false });
  });

  it("keeps the page for the box that is still there when an earlier box of the same page leaves", async () => {
    const first = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    // The second box arrives in a step of its own, before the first one leaves.
    show({ ...viewingReport, isExpanded: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    first.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(calls("artifact_view_close")).toEqual([]);
  });

  it("shows the new page without closing first, whatever the old one still had in flight", async () => {
    // A call that takes a while (the hide for the open menu): the next show must still go out after it, and it replaces the old page itself.
    let release: () => void = () => undefined;
    let isHeld = false;
    spy.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd !== "artifact_view_hide" || isHeld) return fakeTauriInvoke(cmd, args);
      isHeld = true;
      return new Promise((resolve) => (release = () => resolve(undefined)));
    });
    const { props, rerender } = show(viewingReport);
    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Version 3 of 3" }));
    await waitFor(() => expect(calls("artifact_view_hide")).toHaveLength(1));

    // Another session's panel takes its place while that call is still out.
    rerender(<ArtifactsPanel {...props} key="other" sessionId="s-2" artifacts={[STEPS]} viewed={null} />);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(calls("artifact_view_show")).toHaveLength(2));
    const order = spy.mock.calls.map(([cmd]: unknown[]) => cmd).filter((cmd: unknown) => cmd === "artifact_view_show" || cmd === "artifact_view_close");
    expect(order).toEqual(["artifact_view_show", "artifact_view_show"]);
  });
});

describe("export", () => {
  it("says what an exported page is, then saves with ids and the version only", async () => {
    show({ viewed: { artifactId: REPORT.id, version: 2 } });

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    const panel = screen.getByRole("dialog", { name: "Export this page" });
    expect(panel.textContent).toContain("Saves Version 2 as one HTML file. An exported page opens in a browser without Zorvo's limits.");
    expect(calls("artifact_export")).toEqual([]);
    fireEvent.click(within(panel).getByRole("button", { name: "Choose where to save" }));
    await waitFor(() => expect(calls("artifact_export")).toEqual([{ sessionId: "s-1", artifactId: REPORT.id, version: 2 }]));
  });

  it("saves nothing on Cancel", () => {
    show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Export this page" })).toBeNull();
    expect(calls("artifact_export")).toEqual([]);
  });
});

describe("the more menu", () => {
  it("asks before deleting, then deletes and returns to the list", async () => {
    const { props } = show(viewingReport);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete artifact" }));

    expect(calls("artifact_delete")).toEqual([]);
    const question = screen.getByRole("alertdialog", { name: "Delete artifact" });
    expect(question.textContent).toContain("Delete this artifact and its versions? This cannot be undone.");
    fireEvent.click(within(question).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls("artifact_delete")).toEqual([{ sessionId: "s-1", artifactId: REPORT.id }]));
    await waitFor(() => expect(props.onView).toHaveBeenCalledWith(null));
  });

  it("deletes nothing on Cancel", () => {
    show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete artifact" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("artifact_delete")).toEqual([]);
  });

  it("renames", async () => {
    show(viewingReport);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "Rename Session list performance" });
    fireEvent.change(field, { target: { value: "List speed" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(calls("artifact_rename")).toEqual([{ sessionId: "s-1", artifactId: REPORT.id, title: "List speed" }]));
  });
});
