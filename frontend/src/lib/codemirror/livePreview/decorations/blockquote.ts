/**
 * Blockquote decoration builder for Live Preview.
 *
 * When the cursor is outside the blockquote:
 * - QuoteMark (>) characters and trailing space are hidden
 * - Each line gets a left-border accent via line decoration
 * - Nested blockquotes: all QuoteMarks hidden, one line deco per line
 *
 * When the cursor is on ANY line of the blockquote, all decorations
 * are removed (handled by the ViewPlugin's block-level cursor check).
 */
import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { EditorState } from "@codemirror/state";
import type { DecorationRange } from "../types";

const blockquoteLine = Decoration.line({ class: "cm-lp-blockquote" });
const hiddenReplace = Decoration.replace({});

/**
 * Decorate a Blockquote node: hide QuoteMarks, apply left-border
 * line decoration to every line in the block.
 *
 * The caller ensures this is only called when the cursor is NOT
 * inside the blockquote (block-level cursor check).
 */
export function decorateBlockquote(
  node: SyntaxNodeRef,
  state: EditorState,
  ranges: DecorationRange[],
): void {
  const doc = state.doc;
  const seenLines = new Set<number>();

  // Hide all QuoteMarks (including nested blockquote markers)
  const cursor = node.node.cursor();
  cursor.iterate((child) => {
    if (child.name === "QuoteMark") {
      // Hide the > character and trailing space
      const lineEnd = doc.lineAt(child.from).to;
      const hideEnd = Math.min(child.to + 1, lineEnd);
      ranges.push({ from: child.from, to: hideEnd, decoration: hiddenReplace });
    }
  });

  // Apply line decoration to every line in the blockquote
  const firstLineNum = doc.lineAt(node.from).number;
  const lastLineNum = doc.lineAt(node.to).number;
  for (let num = firstLineNum; num <= lastLineNum; num++) {
    if (!seenLines.has(num)) {
      seenLines.add(num);
      const line = doc.line(num);
      ranges.push({
        from: line.from,
        to: line.from,
        decoration: blockquoteLine,
      });
    }
  }
}
