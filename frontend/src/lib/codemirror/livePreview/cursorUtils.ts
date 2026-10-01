/**
 * Cursor-line intersection helper for Live Preview.
 *
 * Used by the ViewPlugin to determine whether the cursor is on
 * a given line. When the cursor is on a line, decorations are
 * skipped so the user sees raw markdown for editing.
 *
 * Granularity is at the LINE level (not per-node) to match
 * Obsidian's behavior and avoid visual jitter.
 */
import type { SelectionRange } from "@codemirror/state";

/**
 * Returns true if ANY selection range overlaps with the line
 * defined by [lineFrom, lineTo].
 *
 * Overlap condition: sel.to >= lineFrom AND sel.from <= lineTo
 */
export function selectionIntersectsLine(
  selections: readonly SelectionRange[],
  lineFrom: number,
  lineTo: number,
): boolean {
  for (const sel of selections) {
    if (sel.to >= lineFrom && sel.from <= lineTo) {
      return true;
    }
  }
  return false;
}
