import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Artifact } from '../types';
import { parseArtifacts } from '../lib/artifacts';

/** Emitted by the backend with `{ sessionId }` after a session's artifacts changed. */
const ARTIFACTS_CHANGED = 'artifacts-changed';

type BySession = ReadonlyMap<string, readonly Artifact[]>;

function parseAnswer(answer: unknown): Array<[string, Artifact[]]> {
  if (!Array.isArray(answer)) return [];
  return answer.flatMap((entry): Array<[string, Artifact[]]> => {
    const sessionId = (entry as { sessionId?: unknown } | null)?.sessionId;
    return typeof sessionId === 'string' ? [[sessionId, parseArtifacts((entry as { artifacts?: unknown }).artifacts)]] : [];
  });
}

/**
 * The artifacts of the given sessions, read from the backend, which owns them.
 * A session is read again when the backend says it changed.
 */
export function useArtifacts(sessionIds: readonly string[]): { bySession: BySession; error: boolean } {
  const [bySession, setBySession] = useState<BySession>(new Map());
  const [error, setError] = useState(false);
  // The ids as one string, so a new array with the same ids asks nothing.
  const key = sessionIds.join('\n');
  const ids = useMemo(() => (key === '' ? [] : key.split('\n')), [key]);
  const idsRef = useRef(ids);
  // An answer for an older list of sessions counts for nothing.
  const generation = useRef(0);
  // Requests are numbered as they go out, and each session remembers the number of the answer it shows:
  // an answer that was asked for earlier never replaces one that was asked for later, whichever arrives last.
  const lastRequest = useRef(0);
  const shownRequest = useRef(new Map<string, number>());

  /** Takes each session's artifacts from an answer, unless a later request already answered for it. */
  const applyAnswer = (answer: unknown, request: number, isFullList: boolean) => {
    const entries = parseAnswer(answer).filter(([sessionId]) => (shownRequest.current.get(sessionId) ?? 0) <= request);
    for (const [sessionId] of entries) shownRequest.current.set(sessionId, request);
    setBySession((previous) => {
      const next = new Map(previous);
      for (const [sessionId, artifacts] of entries) next.set(sessionId, artifacts);
      // A full list is for the sessions listed now: one that is gone takes its artifacts with it.
      if (isFullList) for (const sessionId of next.keys()) if (!idsRef.current.includes(sessionId)) next.delete(sessionId);
      return next;
    });
  };
  const applyAnswerRef = useRef(applyAnswer);
  applyAnswerRef.current = applyAnswer;

  useEffect(() => {
    idsRef.current = ids;
    const current = ++generation.current;
    if (ids.length === 0) {
      setBySession(new Map());
      return;
    }
    const request = ++lastRequest.current;
    invoke('artifact_list', { sessionIds: ids })
      .then((answer) => {
        if (generation.current !== current) return;
        applyAnswerRef.current(answer, request, true);
        setError(false);
      })
      .catch(() => {
        if (generation.current === current) setError(true);
      });
  }, [ids]);

  useEffect(() => {
    let isGone = false;
    const unlisten = listen<unknown>(ARTIFACTS_CHANGED, (event) => {
      const sessionId = (event.payload as { sessionId?: unknown } | null)?.sessionId;
      if (typeof sessionId !== 'string' || !idsRef.current.includes(sessionId)) return;
      const current = generation.current;
      const request = ++lastRequest.current;
      invoke('artifact_list', { sessionIds: [sessionId] })
        .then((answer) => {
          if (isGone || generation.current !== current) return;
          applyAnswerRef.current(answer, request, false);
        })
        .catch(() => undefined);
    });
    return () => {
      isGone = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  return { bySession, error };
}
