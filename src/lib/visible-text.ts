// Control characters other than tab, DEL, the C1 controls (U+0085 breaks a line for many renderers),
// and the invisible marks that reorder or hide text.
// eslint-disable-next-line no-control-regex -- matching these characters is the point.
const ESCAPED = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Makes characters that hide or reshape text visible, so what is read is what is there. */
export function escapeVisible(text: string): string {
  return text.replace(ESCAPED, (char) => `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}

/**
 * `escapeVisible` for text of several lines, such as a command's output: the line breaks stay (a
 * carriage return before one goes with it), and everything else that hides or reshapes text shows.
 */
export function escapeVisibleLines(text: string): string {
  return text
    .split('\n')
    .map((line) => escapeVisible(line.endsWith('\r') ? line.slice(0, -1) : line))
    .join('\n');
}
