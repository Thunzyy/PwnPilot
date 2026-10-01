/**
 * Horizontal rule decoration builder for Live Preview.
 *
 * When the cursor is outside the line:
 * - The entire HR syntax (---, ***, ___) is replaced with a
 *   styled <hr> widget element.
 *
 * When the cursor is on the HR line, the raw markdown is shown
 * (handled by the ViewPlugin's line-level cursor check).
 */
import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { EditorState } from "@codemirror/state";
import type { DecorationRange } from "../types";

/** Widget that renders a styled horizontal rule element. */
class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cm-lp-hr";
    return hr;
  }

  eq(): boolean {
    return true; // All HR widgets are identical
  }

  ignoreEvent(): boolean {
    return true; // Non-interactive
  }
}

const hrReplace = Decoration.replace({ widget: new HrWidget() });

/**
 * Decorate a HorizontalRule node: replace entire line content with
 * a styled <hr> widget.
 *
 * The caller ensures this is only called when the cursor is NOT
 * on the HR line (line-level cursor check).
 */
export function decorateHorizontalRule(
  node: SyntaxNodeRef,
  state: EditorState,
  ranges: DecorationRange[],
): void {
  const line = state.doc.lineAt(node.from);
  ranges.push({ from: line.from, to: line.to, decoration: hrReplace });
}
