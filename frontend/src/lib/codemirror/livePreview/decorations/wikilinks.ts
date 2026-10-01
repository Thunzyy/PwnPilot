/**
 * Regex-based wikilink detection and decoration builder.
 *
 * Wikilinks ([[page]] and [[page|display]]) are not part of the
 * standard Markdown syntax tree, so they are detected via regex on
 * each visible line. The resolver facet is used to determine whether
 * the target document exists (resolved vs broken styling).
 *
 * Decoration:
 * - Hide [[ prefix and ]] suffix
 * - For pipe variant [[page|display]]: hide everything up to and
 *   including the pipe, show only display text
 * - Apply link styling with data-wikilink-target for click handling
 */
import { Decoration } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { wikilinkResolverFacet } from "../facets";
import type { DecorationRange } from "../types";

/** Replace decoration that hides matched content (zero-width). */
const hiddenReplace = Decoration.replace({});

/**
 * Regex matching wikilinks: [[target]] or [[target|display]]
 * Group 1: target (page name)
 * Group 2: display text (optional, after pipe)
 */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Scan a line for wikilinks and add decorations.
 *
 * @param lineFrom - Document offset of the line start
 * @param lineText - The text content of the line
 * @param state - Editor state (for reading facets)
 * @param ranges - Decoration range accumulator
 */
export function decorateWikilinks(
  lineFrom: number,
  lineText: string,
  state: EditorState,
  ranges: DecorationRange[],
): void {
  const resolver = state.facet(wikilinkResolverFacet);

  // Reset regex lastIndex before each line scan
  WIKILINK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(lineText)) !== null) {
    const target = match[1];
    const display = match[2]; // undefined if no pipe
    const matchStart = lineFrom + match.index;
    const matchEnd = matchStart + match[0].length;

    // Check if the target resolves to a real document
    const isResolved = resolver(target) !== null;

    const wikilinkClass = isResolved
      ? "cm-lp-link cm-lp-wikilink"
      : "cm-lp-link cm-lp-wikilink-broken";

    const wikilinkMark = Decoration.mark({
      class: wikilinkClass,
      attributes: { "data-wikilink-target": target },
    });

    if (display !== undefined) {
      // Pipe variant: [[target|display]]
      // Hide everything from [[ up to and including |
      const pipeOffset = match[0].indexOf("|");
      const contentStart = matchStart + pipeOffset + 1;
      const contentEnd = matchEnd - 2; // before ]]

      // Hide [[target|
      ranges.push({
        from: matchStart,
        to: contentStart,
        decoration: hiddenReplace,
      });

      // Style display text
      if (contentStart < contentEnd) {
        ranges.push({
          from: contentStart,
          to: contentEnd,
          decoration: wikilinkMark,
        });
      }

      // Hide ]]
      ranges.push({
        from: contentEnd,
        to: matchEnd,
        decoration: hiddenReplace,
      });
    } else {
      // Simple variant: [[target]]
      const contentStart = matchStart + 2; // after [[
      const contentEnd = matchEnd - 2; // before ]]

      // Hide [[
      ranges.push({
        from: matchStart,
        to: contentStart,
        decoration: hiddenReplace,
      });

      // Style target text
      if (contentStart < contentEnd) {
        ranges.push({
          from: contentStart,
          to: contentEnd,
          decoration: wikilinkMark,
        });
      }

      // Hide ]]
      ranges.push({
        from: contentEnd,
        to: matchEnd,
        decoration: hiddenReplace,
      });
    }
  }
}
