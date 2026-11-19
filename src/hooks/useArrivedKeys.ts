import { useState } from "react";

const NONE: ReadonlySet<string> = new Set();

interface Seen {
  scope: string | undefined;
  /** The keys the scope already had when it was first shown: its history, which does not fade in. */
  history: ReadonlySet<string>;
  /** False while the scope has shown nothing yet, so its first keys may still be a load. */
  isSettled: boolean;
}

const seenFor = (scope: string | undefined, keys: readonly string[]): Seen => ({
  scope,
  history: new Set(keys),
  isSettled: keys.length > 0,
});

/**
 * The keys (a message, a card) that arrived while `scope` (a conversation) was on screen, so they fade
 * in once. What a switch of conversation or a load brings is history and never fades: the keys a scope
 * first shows, and several that come at once into a scope that showed none (its transcript read from
 * disk). One key into an empty scope is its first message, which arrives.
 */
export function useArrivedKeys(scope: string | undefined, keys: readonly string[]): ReadonlySet<string> {
  const [seen, setSeen] = useState(() => seenFor(scope, keys));
  if (seen.scope !== scope) {
    setSeen(seenFor(scope, keys));
    return NONE;
  }
  if (!seen.isSettled && keys.length > 0) {
    if (keys.length > 1) {
      setSeen(seenFor(scope, keys));
      return NONE;
    }
    setSeen({ ...seen, isSettled: true });
  }
  const arrived = keys.filter((key) => !seen.history.has(key));
  return arrived.length === 0 ? NONE : new Set(arrived);
}
