import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLatest } from './useLatest';

/** The page a box shows; a new `reload` number makes a new view of the same page. */
export interface ArtifactViewTarget {
  sessionId: string;
  artifactId: string;
  version: number;
  reload: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(box: HTMLElement): Rect {
  const { x, y, width, height } = box.getBoundingClientRect();
  return { x, y, width, height };
}

const isSameRect = (a: Rect | null, b: Rect) => a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Shows an artifact's page over `boxRef`. The page lives in a webview of its
 * own, which the backend places: this hook only says which page, where the
 * box is, and when something of Zorvo's covers it. The webview sends ids and a
 * rectangle, never a URL or a path.
 */
export function useArtifactView(
  boxRef: RefObject<HTMLElement | null>,
  target: ArtifactViewTarget | null,
  isCovered: boolean,
  onError: (message: string) => void,
): void {
  const onErrorRef = useLatest(onError);
  const isCoveredRef = useLatest(isCovered);
  // Calls go out one at a time: an async command may otherwise overtake the one before it.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastRect = useRef<Rect | null>(null);
  const hasView = useRef(false);

  const targetKey = target === null ? null : `${target.sessionId}/${target.artifactId}/${target.version}/${target.reload}`;
  const targetRef = useLatest(target);

  useEffect(() => {
    const shown = targetRef.current;
    const box = boxRef.current;
    if (shown === null || box === null) return;
    const rect = rectOf(box);
    lastRect.current = rect;
    hasView.current = true;
    queue.current = queue.current
      .then(() =>
        invoke('artifact_view_show', {
          sessionId: shown.sessionId,
          artifactId: shown.artifactId,
          version: shown.version,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }),
      )
      .then(() => (isCoveredRef.current ? invoke('artifact_view_hide', { hidden: true }) : undefined))
      .catch((error) => onErrorRef.current(typeof error === 'string' ? error : 'Zorvo could not show that page.'));

    // The box moves with the window, the inspector's width and Expand: the page follows it.
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = boxRef.current;
        if (current === null) return;
        const next = rectOf(current);
        if (isSameRect(lastRect.current, next)) return;
        lastRect.current = next;
        queue.current = queue.current
          .then(() => invoke('artifact_view_bounds', { x: next.x, y: next.y, width: next.width, height: next.height }))
          .catch(() => undefined);
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    observer?.observe(box);
    observer?.observe(document.body);
    window.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', follow);
      hasView.current = false;
      queue.current = queue.current.then(() => invoke('artifact_view_close')).catch(() => undefined);
    };
  }, [targetKey, boxRef, targetRef, isCoveredRef, onErrorRef]);

  useEffect(() => {
    if (!hasView.current) return;
    queue.current = queue.current.then(() => invoke('artifact_view_hide', { hidden: isCovered })).catch(() => undefined);
  }, [isCovered]);
}

/** Points of the box, inset from its edges, that must be free for the page to show. */
const SAMPLES = [0.1, 0.5, 0.9];

function isCoveredNow(box: HTMLElement): boolean {
  if (typeof document.elementFromPoint !== 'function') return false;
  const { x, y, width, height } = box.getBoundingClientRect();
  if (width === 0 || height === 0) return false;
  return SAMPLES.some((fx) =>
    SAMPLES.some((fy) => {
      const top = document.elementFromPoint(x + width * fx, y + height * fy);
      return top !== null && top !== box && !box.contains(top);
    }),
  );
}

/**
 * Whether anything of Zorvo's is drawn over the box: a menu, a dialog, a toast.
 * The page is a native layer above the HTML, so it must be hidden then. This
 * looks at what is on top at a grid of points whenever the document changes,
 * so no overlay has to announce itself.
 */
export function useBoxCovered(boxRef: RefObject<HTMLElement | null>, isActive: boolean): boolean {
  const [isCovered, setIsCovered] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setIsCovered(false);
      return;
    }
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = boxRef.current;
        if (box !== null) setIsCovered(isCoveredNow(box));
      });
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    window.addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [boxRef, isActive]);

  return isCovered;
}
