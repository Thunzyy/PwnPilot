/**
 * Heading decoration builder for Live Preview.
 *
 * Handles ATXHeading1 through ATXHeading6 nodes by:
 * 1. Applying a line decoration with the correct .cm-lp-h{level} class
 * 2. Hiding the HeaderMark (#) characters and trailing space via replace decoration
 *
 * When the cursor is on the heading line, these decorations are NOT applied
 * (handled by the ViewPlugin's cursor check), so the user sees raw `## Title`.
 */
import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { EditorState } from "@codemirror/state";
import type { DecorationRange } from "../types";

/** Pre-created line decorations for each heading level (reused across calls). */
const headingLineDecos: Record<number, Decoration> = {
  1: Decoration.line({ class: "cm-lp-h1" }),
  2: Decoration.line({ class: "cm-lp-h2" }),
  3: Decoration.line({ class: "cm-lp-h3" }),
  4: Decoration.line({ class: "cm-lp-h4" }),
  5: Decoration.line({ class: "cm-lp-h5" }),
  6: Decoration.line({ class: "cm-lp-h6" }),
};

/** Replace decoration that hides matched content (zero-width). */
const hiddenReplace = Decoration.replace({});

/**
 * Decorate an ATXHeading node: apply line-level heading style and
 * hide the `#` marks plus trailing space.
 */
export function decorateHeading(
  node: SyntaxNodeRef,
  state: EditorState,
  ranges: DecorationRange[],
): void {
  // Extract heading level from node name: "ATXHeading1" -> 1, etc.
  const level = parseInt(node.name.charAt(node.name.length - 1), 10);
  if (level < 1 || level > 6) return;

  const line = state.doc.lineAt(node.from);

  // Line decoration: from === to === line.from (required by CodeMirror)
  const lineDeco = headingLineDecos[level];
  if (lineDeco) {
    ranges.push({ from: line.from, to: line.from, decoration: lineDeco });
  }

  // Hide HeaderMark children (the # characters) and trailing space
  const headerMarks = node.node.getChildren("HeaderMark");
  for (const mark of headerMarks) {
    // +1 to also hide the space after "## "
    const hideEnd = Math.min(mark.to + 1, line.to);
    ranges.push({ from: mark.from, to: hideEnd, decoration: hiddenReplace });
  }
}
