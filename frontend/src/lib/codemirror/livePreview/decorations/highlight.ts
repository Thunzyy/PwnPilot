/**
 * Decoration builder for ==highlight== nodes from the custom
 * HighlightExtension parser.
 *
 * Hides the == delimiters (HighlightMark children) and styles the
 * content between them with an accent background. Follows the same
 * pattern as decorateStrikethrough in inline.ts.
 */
import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { DecorationRange } from "../types";

/** Replace decoration that hides matched content (zero-width). */
const hiddenReplace = Decoration.replace({});

/** Mark decoration for highlighted content. */
const highlightMark = Decoration.mark({ class: "cm-lp-highlight" });

/**
 * Decorate a Highlight node: hide == delimiters and style content.
 *
 * Structure of a Highlight node (from HighlightExtension):
 *   HighlightMark  (opening ==)
 *   ...content...
 *   HighlightMark  (closing ==)
 */
export function decorateHighlight(
  node: SyntaxNodeRef,
  ranges: DecorationRange[],
): void {
  const marks = node.node.getChildren("HighlightMark");
  if (marks.length < 2) return;

  const firstMark = marks[0];
  const lastMark = marks[marks.length - 1];

  // Hide == delimiters
  for (const mark of marks) {
    ranges.push({ from: mark.from, to: mark.to, decoration: hiddenReplace });
  }

  // Style content between delimiters
  if (firstMark.to < lastMark.from) {
    ranges.push({
      from: firstMark.to,
      to: lastMark.from,
      decoration: highlightMark,
    });
  }
}
