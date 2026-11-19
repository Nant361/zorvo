import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FOCUS_REFRESH_MS, TURN_REFRESH_MS, useWorkspacePullRequests } from "../hooks/useWorkspacePullRequests";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;

const answer = (number: number) => ({
  branch: "main",
  pullRequests: [
    { branch: "feat/row", number, title: "Row", url: "u", state: "open", isDraft: false, checks: { passing: 0, failing: 0, pending: 0 } },
  ],
});

/** Spies on invoke and answers `workspace_pull_requests` with `reply(path)`; returns the folders asked for. */
function fakeBackend(reply: (path: string) => Promise<unknown>) {
  const asked: string[] = [];
  const original = internals().invoke;
  vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd !== "workspace_pull_requests") return original(cmd, args);
    const path = String(args?.path);
    asked.push(path);
    return reply(path);
  });
  return asked;
}

const settle = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useWorkspacePullRequests", () => {
  it("reads each folder once, one gh call for every session in it", async () => {
    const asked = fakeBackend(async () => answer(250));
    const { result } = renderHook(() => useWorkspacePullRequests(["/w/a", "/w/b", "/w/a"], true, []));
    await settle();

    expect(asked.sort()).toEqual(["/w/a", "/w/b"]);
    expect(result.current.get("/w/a")?.pullRequests[0].number).toBe(250);
    expect(result.current.get("/w/a")?.branch).toBe("main");
  });

  it("reads nothing while gh is missing or signed out", async () => {
    const asked = fakeBackend(async () => answer(250));
    const { result } = renderHook(() => useWorkspacePullRequests(["/w/a"], false, []));
    await settle();

    expect(asked).toEqual([]);
    expect(result.current.size).toBe(0);
  });

  it("reads a folder again on focus only once its last read is two minutes old", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const asked = fakeBackend(async () => answer(250));
    renderHook(() => useWorkspacePullRequests(["/w/a"], true, []));
    await settle();

    vi.setSystemTime(1_000_000 + FOCUS_REFRESH_MS - 1);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(asked).toEqual(["/w/a"]);

    vi.setSystemTime(1_000_000 + FOCUS_REFRESH_MS);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(asked).toEqual(["/w/a", "/w/a"]);
  });

  it("reads the folder of a session whose turn ended, at most once a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const asked = fakeBackend(async () => answer(250));
    const { rerender } = renderHook(({ busy }) => useWorkspacePullRequests(["/w/a", "/w/b"], true, busy), {
      initialProps: { busy: ["/w/a"] as string[] },
    });
    await settle();
    expect(asked.sort()).toEqual(["/w/a", "/w/b"]);

    vi.setSystemTime(1_000_000 + TURN_REFRESH_MS);
    rerender({ busy: [] });
    await settle();
    // Only the folder whose session finished, not every folder.
    expect(asked.filter((path) => path === "/w/a")).toHaveLength(2);
    expect(asked.filter((path) => path === "/w/b")).toHaveLength(1);

    rerender({ busy: ["/w/a"] });
    rerender({ busy: [] });
    await settle();
    expect(asked.filter((path) => path === "/w/a")).toHaveLength(2);
  });

  it("keeps the last answer through a failure and drops it after three in a row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let time = 1_000_000;
    vi.setSystemTime(time);
    let isFailing = false;
    fakeBackend(async () => {
      if (isFailing) throw new Error("gh auth login");
      return answer(250);
    });
    const { result } = renderHook(() => useWorkspacePullRequests(["/w/a"], true, []));
    await settle();
    isFailing = true;

    for (let failure = 1; failure <= 3; failure++) {
      time += FOCUS_REFRESH_MS;
      vi.setSystemTime(time);
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await settle();
      expect(result.current.has("/w/a"), `after failure ${failure}`).toBe(failure < 3);
    }
  });
});
