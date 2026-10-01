/**
 * Core ViewPlugin for Live Preview decorations.
 *
 * This plugin rebuilds decorations on docChanged, viewportChanged,
 * and selectionSet. Decoration computation is scoped to
 * view.visibleRanges only (never full document) for performance.
 *
 * Cursor detection works at LINE level -- the entire line is
 * excluded from decoration when the cursor is on it, matching
 * Obsidian's behavior.
 *
 * Dispatches to decoration builders:
 * - decorateHeading: ATXHeading1-6 (line deco + HeaderMark hiding)
 * - decorateInline: StrongEmphasis, Emphasis, Strikethrough, InlineCode
 * - decorateCodeBlock: FencedCode (fence hiding, content styling, copy button)
 * - decorateLink: Link nodes ([text](url)) with data-href for click handling
 * - decorateHighlight: Highlight nodes (==text==) from custom parser
 * - decorateWikilinks: regex-based [[page]] scanning on non-cursor lines
 * - decorateBlockquote: Blockquote (block-level cursor, left border accent)
 * - decorateHorizontalRule: HorizontalRule (styled <hr> widget replacement)
 * - decorateListItem: ListItem (bullet dot widget, styled ordered numbers)
 * - decorateTask: Task within ListItem (interactive checkbox widget, strikethrough)
 */
import {
  ViewPlugin,
  type ViewUpdate,
  type DecorationSet,
  type EditorView,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSet } from "@codemirror/state";
import { selectionIntersectsLine } from "./cursorUtils";
import { decorateHeading } from "./decorations/headings";
import { decorateInline } from "./decorations/inline";
import { decorateCodeBlock } from "./decorations/codeblock";
import { decorateLink } from "./decorations/links";
import { decorateWikilinks } from "./decorations/wikilinks";
import { decorateHighlight } from "./decorations/highlight";
import { decorateBlockquote } from "./decorations/blockquote";
import { decorateHorizontalRule } from "./decorations/horizontalRule";
import { decorateListItem } from "./decorations/lists";
import { decorateTask } from "./decorations/tasks";
import type { DecorationRange } from "./types";

class LivePreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  /**
   * Build decorations for all visible ranges.
   *
   * Uses RangeSet.of(ranges, true) for auto-sorting (addresses
   * pitfall P4 -- no manual ordering required).
   *
   * Iterates only view.visibleRanges (addresses pitfall P1 --
   * viewport-only, never full document).
   *
   * Tracks current line to avoid repeated doc.lineAt() calls for
   * nodes on the same line (performance optimization).
   */
  buildDecorations(view: EditorView): DecorationSet {
    const selections = view.state.selection.ranges;
    const ranges: DecorationRange[] = [];

    for (const { from, to } of view.visibleRanges) {
      // Track current line to avoid repeated doc.lineAt() calls
      let currentLineFrom = -1;
      let currentLineTo = -1;
      let cursorOnCurrentLine = false;

      syntaxTree(view.state).iterate({
        from,
        to,
        enter(node) {
          // Block-level handling: FencedCode spans multiple lines
          // Must check before line-level cursor check
          if (node.name === "FencedCode") {
            if (
              selectionIntersectsLine(selections, node.from, node.to)
            ) {
              return false; // Cursor in block — show raw markdown
            }
            decorateCodeBlock(node, view.state, ranges);
            return false; // Children handled inside decorateCodeBlock
          }

          // Block-level handling: Blockquote spans multiple lines
          // Reveals entire block when cursor enters any line
          if (node.name === "Blockquote") {
            if (
              selectionIntersectsLine(selections, node.from, node.to)
            ) {
              return false; // Cursor in block — show raw markdown
            }
            decorateBlockquote(node, view.state, ranges);
            return false; // Children handled inside decorateBlockquote
          }

          // Recalculate line info only when node is on a different line
          if (node.from < currentLineFrom || node.from > currentLineTo) {
            const line = view.state.doc.lineAt(node.from);
            currentLineFrom = line.from;
            currentLineTo = line.to;
            cursorOnCurrentLine = selectionIntersectsLine(
              selections,
              line.from,
              line.to,
            );
          }

          // If cursor is on this line, skip all decorations (show raw markdown)
          if (cursorOnCurrentLine) {
            return false; // Skip children too
          }

          // Dispatch to link decoration builder (must return false to
          // skip children -- prevents double-decoration of inline
          // formatting inside links, see Pitfall 3)
          if (node.name === "Link") {
            decorateLink(node, view.state, ranges);
            return false;
          }

          // Dispatch to highlight decoration builder (==text==)
          if (node.name === "Highlight") {
            decorateHighlight(node, ranges);
            return false;
          }

          // Dispatch to heading decoration builder
          if (node.name.startsWith("ATXHeading")) {
            decorateHeading(node, view.state, ranges);
            return false; // Children handled inside decorateHeading
          }

          // Dispatch to horizontal rule decoration builder
          if (node.name === "HorizontalRule") {
            decorateHorizontalRule(node, view.state, ranges);
            return false;
          }

          // Dispatch to list item decoration builder
          // Task-containing items get checkbox widgets; regular items get styled markers
          if (node.name === "ListItem") {
            const taskChild = node.node.getChild("Task");
            if (taskChild) {
              decorateTask(taskChild, view.state, ranges);
            } else {
              decorateListItem(node, view.state, ranges);
            }
            return false; // Skip children (Paragraph, nested lists, Task)
          }

          // Dispatch to inline decoration builder
          switch (node.name) {
            case "StrongEmphasis":
            case "Emphasis":
            case "Strikethrough":
            case "InlineCode":
              decorateInline(node, ranges);
              return false; // Children handled inside decorateInline
          }
        },
      });

      // Wikilink scanning: regex-based, not node-based.
      // Scan each visible line that does NOT have the cursor on it.
      const doc = view.state.doc;
      let lineNo = doc.lineAt(from).number;
      const lastLineNo = doc.lineAt(Math.min(to, doc.length)).number;
      while (lineNo <= lastLineNo) {
        const line = doc.line(lineNo);
        if (!selectionIntersectsLine(selections, line.from, line.to)) {
          decorateWikilinks(line.from, line.text, view.state, ranges);
        }
        lineNo++;
      }
    }

    return RangeSet.of(
      ranges.map((r) => r.decoration.range(r.from, r.to)),
      true, // Auto-sort: addresses pitfall P4
    );
  }
}

export const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (plugin) => plugin.decorations,
});
