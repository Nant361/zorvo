import { useEffect, useState } from 'react';

const TICK_MS = 1000;

/** The current time, refreshed every second while `isActive`. */
export function useNow(isActive: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const [wasActive, setWasActive] = useState(isActive);
  // Refreshed while rendering, so the first frame after it turns on is not stale.
  if (isActive !== wasActive) {
    setWasActive(isActive);
    if (isActive) setNow(Date.now());
  }
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [isActive]);
  return now;
}
