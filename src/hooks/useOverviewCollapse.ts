import { useCallback, useState } from 'react';

/** Which sessions have their overview card folded to its pill; in memory only, so a restart opens every card. */
export function useOverviewCollapse(): { isCollapsed: (sessionId: string) => boolean; toggle: (sessionId: string) => void } {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const isCollapsed = useCallback((sessionId: string) => collapsed.has(sessionId), [collapsed]);
  const toggle = useCallback((sessionId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);
  return { isCollapsed, toggle };
}
