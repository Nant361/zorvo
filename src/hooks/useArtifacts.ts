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

  useEffect(() => {
    idsRef.current = ids;
    const current = ++generation.current;
    if (ids.length === 0) {
      setBySession(new Map());
      return;
    }
    invoke('artifact_list', { sessionIds: ids })
      .then((answer) => {
        if (generation.current !== current) return;
        setBySession(new Map(parseAnswer(answer)));
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
      invoke('artifact_list', { sessionIds: [sessionId] })
        .then((answer) => {
          if (isGone || generation.current !== current) return;
          setBySession((previous) => new Map([...previous, ...parseAnswer(answer)]));
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
