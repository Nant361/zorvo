/** What Zorvo can open for a link: web pages and mail, in the user's own apps. */
export const OPENABLE_URL = /^(https?:|mailto:)/i;

export interface OpenableLink {
  anchor: HTMLAnchorElement;
  /** The address as written, not resolved against the app's own page. */
  href: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Room kept between the menu and the window's edge. */
const EDGE_MARGIN = 8;

/** The link around a node, whatever its address. */
export function linkAt(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Node)) return null;
  const element = target instanceof Element ? target : target.parentElement;
  return element?.closest<HTMLAnchorElement>("a[href]") ?? null;
}

/** The link around a node when Zorvo can open it in the user's browser or mail app. */
export function openableLinkAt(target: EventTarget | null): OpenableLink | null {
  const anchor = linkAt(target);
  const href = anchor?.getAttribute("href")?.trim() ?? "";
  if (!anchor || !OPENABLE_URL.test(href)) return null;
  return { anchor, href };
}

/** Where a menu of `size` opens at `point`, moved back inside the window when it would run past an edge. */
export function menuPlacement(point: Point, size: Size, viewport: Size): { left: number; top: number } {
  const maxLeft = Math.max(EDGE_MARGIN, viewport.width - size.width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, viewport.height - size.height - EDGE_MARGIN);
  return { left: Math.min(Math.max(point.x, EDGE_MARGIN), maxLeft), top: Math.min(Math.max(point.y, EDGE_MARGIN), maxTop) };
}

/** The address as shown in the menu: without its scheme, so the part that differs comes first. */
export function shownAddress(href: string): string {
  return href.replace(/^(https?:\/\/|mailto:)/i, "");
}
