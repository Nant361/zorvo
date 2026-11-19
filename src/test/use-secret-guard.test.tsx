import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSecretGuard } from "../hooks/useSecretGuard";

const AWS = ["AKIA", "IOSFODNN7EXAMPL", "E"].join("");

describe("useSecretGuard", () => {
  it("queues a second message while the first scan is pending", async () => {
    const onEdit = vi.fn();
    const { result } = renderHook(() =>
      useSecretGuard({ isEnabled: true, root: "/w", agentName: "Qwen Code", onEdit }),
    );
    const first = vi.fn();
    const second = vi.fn();

    act(() => {
      result.current.check({ text: `first ${AWS}` }, first);
      result.current.check({ text: `second ${AWS}` }, second);
    });

    await waitFor(() => expect(result.current.review?.message.text).toBe(`first ${AWS}`));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    act(() => result.current.sendAnyway());

    await waitFor(() => expect(result.current.review?.message.text).toBe(`second ${AWS}`));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    act(() => result.current.sendAnyway());
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("sends a message nothing scans at once, even while another session's review is held", async () => {
    const { result } = renderHook(() =>
      useSecretGuard({ isEnabled: true, root: "/w", agentName: "Qwen Code", onEdit: vi.fn() }),
    );
    const held = vi.fn();
    const plain = vi.fn();
    act(() => result.current.check({ text: `private ${AWS}` }, held));
    await waitFor(() => expect(result.current.review).not.toBeNull());

    act(() =>
      result.current.check({ text: "from a plain session" }, plain, {
        isEnabled: false,
        root: "/other",
        agentName: "Codex",
        sessionId: "s-plain",
      }),
    );

    expect(plain).toHaveBeenCalledTimes(1);
    expect(held).not.toHaveBeenCalled();
  });

  it("says a draft's message is being checked until its scan ends", async () => {
    const { result } = renderHook(() =>
      useSecretGuard({ isEnabled: true, root: "/w", agentName: "Qwen Code", onEdit: vi.fn() }),
    );
    const deliver = vi.fn();

    act(() =>
      result.current.check({ text: "nothing secret here" }, deliver, {
        isEnabled: true,
        root: "/w",
        agentName: "Qwen Code",
      }),
    );
    expect(result.current.isCheckingDraft).toBe(true);

    await waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isCheckingDraft).toBe(false));
  });

  it("keeps the held message's review-comment slot for Edit", async () => {
    const onEdit = vi.fn();
    const { result } = renderHook(() =>
      useSecretGuard({ isEnabled: true, root: "/w", agentName: "Qwen Code", onEdit }),
    );
    const slot = { sessionId: "s-1", commentIds: ["c-1"], lastTarget: "head" as const };

    act(() => {
      result.current.check({ text: `key ${AWS}` }, vi.fn(), {
        isEnabled: true,
        root: "/w",
        agentName: "Qwen Code",
        sessionId: "s-1",
        reviewSlot: slot,
      });
    });
    await waitFor(() => expect(result.current.review).not.toBeNull());

    act(() => result.current.edit());

    expect(onEdit).toHaveBeenCalledWith("s-1", { text: `key ${AWS}` }, slot);
  });

  it("gives the held message's session to Edit", async () => {
    const onEdit = vi.fn();
    const { result } = renderHook(() =>
      useSecretGuard({ isEnabled: true, root: "/w", agentName: "Qwen Code", onEdit }),
    );

    act(() => {
      result.current.check({ text: `key ${AWS}` }, vi.fn(), {
        isEnabled: true,
        root: "/w",
        agentName: "Qwen Code",
        sessionId: "s-1",
      });
    });
    await waitFor(() => expect(result.current.review).not.toBeNull());

    act(() => result.current.edit());

    expect(onEdit).toHaveBeenCalledWith("s-1", { text: `key ${AWS}` }, undefined);
  });
});