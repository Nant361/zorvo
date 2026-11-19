import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef } from "react";
import { parsePrivateSessionUsage } from "../lib/private-usage";
import type { Session } from "../types";

interface PrivateUsageDeps {
  sessions: readonly Session[];
  /** Writes the last total on the session, the only place it is kept across a restart. */
  updateSession: (sessionId: string, usage: NonNullable<Session["privateUsage"]>) => void;
}

type Usage = NonNullable<Session["privateUsage"]>;

const BASE_KEY = "zorvo.privateUsageBase.";

/**
 * The total a session had before this app run, as an earlier page of the same run noted it.
 * sessionStorage outlives a window reload and not the app, exactly like the backend's records:
 * without it a reloaded page would take the saved total, which already counts this run's
 * records, as the base and count them twice.
 */
function readBase(sessionId: string): Usage | undefined {
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(BASE_KEY + sessionId) ?? "null");
    if (typeof saved !== "object" || saved === null) return undefined;
    const { credits, estimated } = saved as Record<string, unknown>;
    if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0) return undefined;
    return { credits, estimated: estimated === true };
  } catch {
    return undefined;
  }
}

function writeBase(sessionId: string, base: Usage) {
  try {
    window.sessionStorage.setItem(BASE_KEY + sessionId, JSON.stringify(base));
  } catch {
    // Without the note a reload falls back to the saved total, as before.
  }
}

/**
 * Reads a private session's usage at the same turn-end checks as verification. The backend's
 * records live for the app run, so the first read of a session in a run adds its answer to the
 * total saved before the last restart.
 */
export function usePrivateUsage({ sessions, updateSession }: PrivateUsageDeps) {
  const deps = useRef({ sessions, updateSession });
  deps.current = { sessions, updateSession };
  const bases = useRef(new Map<string, NonNullable<Session["privateUsage"]>>());
  const runs = useRef(new Map<string, number>());
  const refreshRef = useRef<(sessionId: string, isOwnerRead?: boolean) => void>(() => {});

  /**
   * Reads the session's total. A native fork runs in its source's process on its source's proxy
   * token, so the backend counts the fork's calls for the session that token names and says which
   * (`countedFor`): that session's total is read too, or what the fork spent would be in no total
   * until that session ran again. The backend names the owner, not the fork's ancestry here: a
   * deleted fork in between, or a deleted source, would break that chain.
   */
  const refresh = useCallback((sessionId: string, isOwnerRead = false) => {
    const { sessions, updateSession } = deps.current;
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session?.privateMode) return;
    const run = (runs.current.get(sessionId) ?? 0) + 1;
    runs.current.set(sessionId, run);
    void invoke<unknown>("private_session_usage", { sessionId })
      .then((answer) => {
        if (runs.current.get(sessionId) !== run) return;
        const usage = parsePrivateSessionUsage(answer);
        if (!usage) return;
        // One step only: the owner's own answer names nobody.
        if (!isOwnerRead && usage.countedFor && usage.countedFor !== sessionId) refreshRef.current(usage.countedFor, true);
        const known = bases.current.get(sessionId);
        const base = known ?? readBase(sessionId) ?? session.privateUsage ?? { credits: 0, estimated: false };
        if (!known) {
          bases.current.set(sessionId, base);
          writeBase(sessionId, base);
        }
        updateSession(sessionId, {
          credits: base.credits + usage.credits,
          estimated: base.estimated || usage.estimated,
        });
      })
      .catch(() => {
        // A failed read leaves the last saved total in place; the next turn end asks again.
      });
  }, []);

  refreshRef.current = refresh;

  return { refresh: useCallback((sessionId: string) => refreshRef.current(sessionId), []) };
}