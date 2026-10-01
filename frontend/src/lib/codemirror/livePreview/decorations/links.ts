/**
 * Decoration builder for standard markdown [text](url) links.
 *
 * Hides the `[`, `](url)` parts and styles the link text as a
 * clickable link. The URL is stored in a data attribute for the
 * click handler in index.ts.
 *
 * Returns early for Image nodes (where first LinkMark is `![` with
 * length 2) to avoid decorating images as links.
 */
import { Decoration } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import type { DecorationRange } from "../types";

/** Replace decoration that hides matched content (zero-width). */
const hiddenReplace = Decoration.replace({});

/**
 * Decorate a Link node: hide syntax characters and style the visible
 * text as a clickable link with the URL stored in data-href.
 *
 * Structure of a Link node:
 *   LinkMark[  → `[`
 *   ...link text...
 *   LinkMark]  → `]`
 *   LinkMark(  → `(`
 *   URL        → the href
 *   LinkMark)  → `)`
 *
 * For Image nodes (![text](url)), the first LinkMark is `![` (2 chars),
 * which we detect and skip.
 */
export function decorateLink(
  node: SyntaxNodeRef,
  state: EditorState,
  ranges: DecorationRange[],
): void {
  const marks = node.node.getChildren("LinkMark");
  const urlNode = node.node.getChild("URL");

  // Need at least 4 LinkMarks ([, ], (, )) and a URL child
  if (marks.length < 4 || !urlNode) return;

  // Skip Image nodes: first LinkMark is `![` (2 chars) not `[` (1 char)
  if (marks[0].to - marks[0].from !== 1) return;

  const urlText = state.doc.sliceString(urlNode.from, urlNode.to);

  // Create mark decoration with the URL stored as a data attribute
  const linkMark = Decoration.mark({
    class: "cm-lp-link",
    attributes: { "data-href": urlText },
  });

  // Hide opening `[`
  ranges.push({
    from: marks[0].from,
    to: marks[0].to,
    decoration: hiddenReplace,
  });

  // Style the link text between `[` and `]`
  if (marks[0].to < marks[1].from) {
    ranges.push({
      from: marks[0].to,
      to: marks[1].from,
      decoration: linkMark,
    });
  }

  // Hide everything from `]` to the last `)` — this covers `](url)`
  const lastMark = marks[marks.length - 1];
  ranges.push({
    from: marks[1].from,
    to: lastMark.to,
    decoration: hiddenReplace,
  });
}
