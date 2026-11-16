import { useCallback, useMemo, useState } from 'react';

/** A task open in the inspector: a subagent by its tool call, a shell command by its background task id. */
export type TaskTab = { kind: 'subagent'; toolId: string } | { kind: 'shell'; taskId: string };

export interface TaskTabs {
  /** The open task tabs of the session on screen, in the order they were opened. */
  tabs: readonly TaskTab[];
  selected: TaskTab | null;
  /** Adds the tab to that session's tabs if it is new, and selects it. */
  open: (sessionId: string, tab: TaskTab) => void;
  select: (tab: TaskTab) => void;
  /** Closes a tab; the selected one hands over to its neighbour. */
  close: (tab: TaskTab) => void;
}

interface SessionTabs {
  tabs: readonly TaskTab[];
  selectedKey: string | null;
}

const NONE: SessionTabs = { tabs: [], selectedKey: null };

export function taskTabKey(tab: TaskTab): string {
  return tab.kind === 'subagent' ? `subagent:${tab.toolId}` : `shell:${tab.taskId}`;
}

function withTab(current: SessionTabs, tab: TaskTab): SessionTabs {
  const key = taskTabKey(tab);
  const has = current.tabs.some((open) => taskTabKey(open) === key);
  return { tabs: has ? current.tabs : [...current.tabs, tab], selectedKey: key };
}

function withoutTab(current: SessionTabs, key: string): SessionTabs {
  const index = current.tabs.findIndex((open) => taskTabKey(open) === key);
  if (index < 0) return current;
  const tabs = current.tabs.filter((_, i) => i !== index);
  if (current.selectedKey !== key) return { tabs, selectedKey: current.selectedKey };
  const neighbour = tabs[index] ?? tabs[index - 1];
  return { tabs, selectedKey: neighbour ? taskTabKey(neighbour) : null };
}

/**
 * The task tabs each session has open. In memory only, like the inspector's own tab. A tab whose
 * task no longer exists (a rewind removed its message, its process ended) stops showing by itself.
 */
export function useTaskTabs(args: { sessionId: string | null; exists: (tab: TaskTab) => boolean }): TaskTabs {
  const { sessionId, exists } = args;
  const [bySession, setBySession] = useState<ReadonlyMap<string, SessionTabs>>(new Map());

  const change = useCallback((id: string, update: (current: SessionTabs) => SessionTabs) => {
    setBySession((all) => {
      const current = all.get(id) ?? NONE;
      const next = update(current);
      return next === current ? all : new Map(all).set(id, next);
    });
  }, []);

  const open = useCallback((id: string, tab: TaskTab) => change(id, (current) => withTab(current, tab)), [change]);
  const select = useCallback(
    (tab: TaskTab) => {
      if (sessionId !== null) change(sessionId, (current) => ({ ...current, selectedKey: taskTabKey(tab) }));
    },
    [change, sessionId],
  );
  const close = useCallback(
    (tab: TaskTab) => {
      if (sessionId !== null) change(sessionId, (current) => withoutTab(current, taskTabKey(tab)));
    },
    [change, sessionId],
  );

  const stored = (sessionId !== null && bySession.get(sessionId)) || NONE;
  const { tabs, selected } = useMemo(() => {
    // A tab that is gone is dropped as if it had been closed, so its neighbour takes over.
    const live = stored.tabs.reduce(
      (current, tab) => (exists(tab) ? current : withoutTab(current, taskTabKey(tab))),
      stored,
    );
    const chosen = live.tabs.find((tab) => taskTabKey(tab) === live.selectedKey) ?? live.tabs[live.tabs.length - 1];
    return { tabs: live.tabs, selected: chosen ?? null };
  }, [stored, exists]);

  return { tabs, selected, open, select, close };
}
