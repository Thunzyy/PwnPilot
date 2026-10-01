/**
 * StateField for image preview block widget decorations.
 *
 * Produces block widget decorations for markdown image syntax:
 * - Standard: ![alt](url) -- detected via AST (Image node)
 * - Wikilink: ![[image.png]] -- detected via regex (no AST node)
 *
 * Uses a StateField (not ViewPlugin) because block widgets are
 * height-changing decorations. CM6 needs to know about ALL block
 * widgets in the document for viewport height calculation, so this
 * field iterates the full document tree (not just visible ranges).
 *
 * Rebuilds on both docChanged and selectionSet to support cursor-
 * aware toggling: cursor on line = raw markdown, cursor away = preview.
 *
 * CRITICAL NOTES (from PITFALLS.md):
 * - P2: StateField required for height-changing decorations
 * - Never use value.map(tr.changes) -- block widget ranges can be
 *   silently dropped by RangeSet mapping optimization
 * - Uses padding (not margin) on wrapper CSS (P3)
 */
import { type EditorState, RangeSet, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { ImagePreviewWidget } from "./decorations/images";

/** Matches wikilink image syntax: ![[filename.ext]] */
const IMAGE_WIKILINK_RE =
  /!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp|ico))\]\]/gi;

/**
 * Build all image block widget decorations for the full document.
 *
 * Step A: AST-based detection for standard ![alt](url) images
 * Step B: Regex-based detection for ![[image.png]] wikilink images
 *
 * Lines with the cursor on them are skipped (show raw markdown).
 */
function buildImageDecorations(state: EditorState): DecorationSet {
  const widgets: ReturnType<typeof Decoration.widget>[] = [];
  const widgetPositions: number[] = [];
  const selections = state.selection.ranges;
  const processedLines = new Set<number>();

  // Step A: AST-based detection for standard ![alt](url) images
  syntaxTree(state).iterate({
    enter(node) {
      if (node.type.name !== "Image") return;

      const line = state.doc.lineAt(node.from);

      // Cursor on line -- show raw markdown, skip preview
      if (selections.some((sel) => sel.to >= line.from && sel.from <= line.to)) {
        return;
      }

      // Extract URL from the Image node
      const urlNode = node.node.getChild("URL");
      if (!urlNode) return;

      const url = state.doc.sliceString(urlNode.from, urlNode.to);
      if (!url) return;

      // Extract alt text from between the first two LinkMark children
      let alt = "";
      const marks = node.node.getChildren("LinkMark");
      if (marks.length >= 2) {
        alt = state.doc.sliceString(marks[0].to, marks[1].from);
      }

      processedLines.add(line.number);
      widgetPositions.push(line.to);
      widgets.push(
        Decoration.widget({
          widget: new ImagePreviewWidget(url, alt),
          block: true,
          side: 1,
        }),
      );
    },
  });

  // Step B: Regex-based detection for ![[image.png]] wikilink images
  for (let i = 1; i <= state.doc.lines; i++) {
    if (processedLines.has(i)) continue;

    const line = state.doc.line(i);

    // Cursor on line -- show raw markdown, skip preview
    if (selections.some((sel) => sel.to >= line.from && sel.from <= line.to)) {
      continue;
    }

    IMAGE_WIKILINK_RE.lastIndex = 0;
    const match = IMAGE_WIKILINK_RE.exec(line.text);
    if (match) {
      const imagePath = match[1];
      widgetPositions.push(line.to);
      widgets.push(
        Decoration.widget({
          widget: new ImagePreviewWidget(imagePath, imagePath),
          block: true,
          side: 1,
        }),
      );
    }
  }

  // Build sorted range set from collected widgets
  const ranges = widgets.map((w, idx) => w.range(widgetPositions[idx]));
  return RangeSet.of(ranges, true);
}

/**
 * StateField that provides image preview block widget decorations.
 *
 * Rebuilds on docChanged (new/removed images) and selectionSet
 * (cursor awareness). Does NOT use value.map(tr.changes) because
 * block widget ranges can be silently dropped by mapping.
 */
export const imagePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildImageDecorations(state);
  },
  update(value, tr) {
    const selectionChanged =
      tr.selection !== undefined && !tr.selection.eq(tr.startState.selection);

    if (tr.docChanged || selectionChanged) {
      return buildImageDecorations(tr.state);
    }
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});
