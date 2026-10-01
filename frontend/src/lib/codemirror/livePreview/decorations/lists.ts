/**
 * List marker decoration builder for Live Preview.
 *
 * When the cursor is outside the list item line:
 * - Bullet markers (-, *, +) are replaced with a styled dot widget
 * - Ordered list markers (1., 2.) are styled with accent color
 *
 * Task items (those with a Task child) are skipped -- handled by
 * Plan 03's checkbox decorator.
 *
 * When the cursor is on a list item line, the raw markdown is shown
 * (handled by the ViewPlugin's line-level cursor check).
 */
import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { EditorState } from "@codemirror/state";
import type { DecorationRange } from "../types";

/** Widget that renders a styled bullet character. */
class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "\u2022"; // Unicode bullet
    return span;
  }

  eq(): boolean {
    return true; // All bullet widgets are identical
  }

  ignoreEvent(): boolean {
    return true; // Non-interactive
  }
}

const bulletReplace = Decoration.replace({ widget: new BulletWidget() });
const listNumberMark = Decoration.mark({ class: "cm-lp-list-number" });

/**
 * Decorate a ListItem node: replace bullet markers with styled dots,
 * or apply accent styling to ordered list numbers.
 *
 * Skips task items (with Task child) to defer to Plan 03's checkbox
 * decorator.
 *
 * The caller ensures this is only called when the cursor is NOT
 * on the list item line (line-level cursor check).
 */
export function decorateListItem(
  node: SyntaxNodeRef,
  state: EditorState,
  ranges: DecorationRange[],
): void {
  // Skip task items -- handled by Plan 03 (checkboxes)
  if (node.node.getChild("Task")) return;

  const mark = node.node.getChild("ListMark");
  if (!mark) return;

  const markText = state.doc.sliceString(mark.from, mark.to);
  const line = state.doc.lineAt(mark.from);

  if (/^\d/.test(markText)) {
    // Ordered list: style the number marker
    ranges.push({
      from: mark.from,
      to: mark.to,
      decoration: listNumberMark,
    });
  } else {
    // Bullet list: replace marker + trailing space with styled dot
    const replaceEnd = Math.min(mark.to + 1, line.to);
    ranges.push({
      from: mark.from,
      to: replaceEnd,
      decoration: bulletReplace,
    });
  }
}
