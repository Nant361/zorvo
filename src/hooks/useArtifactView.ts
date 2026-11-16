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
 * Every call about the one page view goes out through this queue, in the order
 * it was asked for. An async command may otherwise overtake the one before it,
 * and one viewer leaving (its close) must not land after the next one's show.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue(call: () => Promise<unknown>, onError?: (error: unknown) => void): void {
  queue = queue.then(call).catch((error) => onError?.(error));
}

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
  const lastRect = useRef<Rect | null>(null);
  // The target the backend was last asked to show; null while it shows none of ours.
  const shownKey = useRef<string | null>(null);

  // A view is made visible, so only a change from that is worth a call.
  const wasCovered = useRef(false);

  const targetKey = target === null ? null : `${target.sessionId}/${target.artifactId}/${target.version}/${target.reload}`;
  const targetRef = useLatest(target);

  useEffect(() => {
    if (targetKey === null) return;

    /** Brings the backend's view in step with the box: shows the page once the box has a size, then follows it. */
    const sync = () => {
      const box = boxRef.current;
      const shown = targetRef.current;
      if (box === null || shown === null) return;
      const rect = rectOf(box);
      // A box with no size is hidden (Settings and the gallery hide the main sheet without unmounting it):
      // there is nowhere to show the page, and a zero rectangle would make the backend close the view.
      if (rect.width === 0 || rect.height === 0) return;
      if (shownKey.current !== targetKey) {
        shownKey.current = targetKey;
        lastRect.current = rect;
        enqueue(
          () =>
            invoke('artifact_view_show', {
              sessionId: shown.sessionId,
              artifactId: shown.artifactId,
              version: shown.version,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }).then(() => {
              // A new view is visible: hide it at once if something is over its box.
              wasCovered.current = isCoveredRef.current;
              return isCoveredRef.current ? invoke('artifact_view_hide', { hidden: true }) : undefined;
            }),
          (error) => onErrorRef.current(typeof error === 'string' ? error : 'Zorvo could not show that page.'),
        );
        return;
      }
      if (isSameRect(lastRect.current, rect)) return;
      lastRect.current = rect;
      enqueue(() => invoke('artifact_view_bounds', { x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
    };

    sync();
    // The box moves with the window, the inspector's width and Expand, and gets its size back when what hid it closes.
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const box = boxRef.current;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    if (box !== null) observer?.observe(box);
    observer?.observe(document.body);
    window.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', follow);
      if (shownKey.current === null) return;
      shownKey.current = null;
      enqueue(() => invoke('artifact_view_close'));
    };
  }, [targetKey, boxRef, targetRef, isCoveredRef, onErrorRef]);

  useEffect(() => {
    if (shownKey.current === null || wasCovered.current === isCovered) return;
    wasCovered.current = isCovered;
    enqueue(() => invoke('artifact_view_hide', { hidden: isCovered }));
  }, [isCovered]);
}

/** Points of the box, inset from its edges, that must be free for the page to show. */
const SAMPLES = [0.1, 0.5, 0.9];

function isCoveredNow(box: HTMLElement): boolean {
  const { x, y, width, height } = box.getBoundingClientRect();
  // No size: the box is in a part of the window that is hidden, so the page must not show either.
  if (width === 0 || height === 0) return true;
  if (typeof document.elementFromPoint !== 'function') return false;
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
