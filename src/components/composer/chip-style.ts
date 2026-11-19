/**
 * A chip in the composer's row and beside a draft's heading (folder, branch), as the canvas draws it: 26px, radius 6, no fill,
 * in `fg-secondary`, with its chevron where it opens a menu; `surface-hover` under the pointer and with `fg` while its menu is open.
 */
export const COMPOSER_CHIP =
  "focus-ring inline-flex h-6.5 max-w-full items-center gap-1.5 whitespace-nowrap rounded-md bg-transparent px-2 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg aria-expanded:bg-surface-hover aria-expanded:text-fg";

/** What an open mode menu says under a mode that lets the agent act without asking. */
export const RISKY_LINE = "Lets the agent act without asking";

/** A setting's name for a count of its choices: "Model" gives "models". */
export function pluralOf(label: string): string {
  const lower = label.toLowerCase();
  return lower.endsWith("s") ? lower : `${lower}s`;
}
