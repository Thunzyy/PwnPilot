/**
 * Fenced code block decoration builder for Live Preview.
 *
 * When the cursor is outside the code block:
 * - Opening fence line (```lang) becomes the styled top of the block (text hidden)
 * - Closing fence line (```) becomes the styled bottom (text hidden)
 * - Content lines get background/monospace styling
 * - Copy button widget appears at top-right
 *
 * When the cursor is on ANY line of the code block, all decorations
 * are removed (handled by the ViewPlugin's block-level cursor check).
 */
import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { EditorState } from "@codemirror/state";
import type { DecorationRange } from "../types";

const hiddenReplace = Decoration.replace({});
const codeBlockFirstLine = Decoration.line({
  class: "cm-lp-codeblock cm-lp-codeblock-first",
});
const codeBlockLine = Decoration.line({ class: "cm-lp-codeblock" });
const codeBlockLastLine = Decoration.line({
  class: "cm-lp-codeblock cm-lp-codeblock-last",
});

/** Copy button widget rendered at the top-right of the code block. */
class CopyButtonWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "cm-lp-copy-btn";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(this.code);
    });
    return btn;
  }

  eq(other: CopyButtonWidget): boolean {
    return this.code === other.code;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown" || event.type === "click";
  }
}

/**
 * Decorate a FencedCode node: hide fence lines, style content,
 * and add a copy button widget.
 */
export function decorateCodeBlock(
  node: SyntaxNodeRef,
  state: EditorState,
  ranges: DecorationRange[],
): void {
  const doc = state.doc;
  const openLine = doc.lineAt(node.from);
  const closeLine = doc.lineAt(node.to);

  // Need at least 2 lines (open + close fence)
  if (closeLine.number <= openLine.number) return;

  // Get code content for copy button
  const codeText = node.node.getChild("CodeText");
  const codeContent = codeText
    ? doc.sliceString(codeText.from, codeText.to).trimEnd()
    : "";

  // Opening fence: hide text, style as top of code block
  ranges.push({
    from: openLine.from,
    to: openLine.to,
    decoration: hiddenReplace,
  });
  ranges.push({
    from: openLine.from,
    to: openLine.from,
    decoration: codeBlockFirstLine,
  });

  // Closing fence: hide text, style as bottom of code block
  ranges.push({
    from: closeLine.from,
    to: closeLine.to,
    decoration: hiddenReplace,
  });
  ranges.push({
    from: closeLine.from,
    to: closeLine.from,
    decoration: codeBlockLastLine,
  });

  // Content lines between fences
  for (let num = openLine.number + 1; num < closeLine.number; num++) {
    const line = doc.line(num);
    ranges.push({ from: line.from, to: line.from, decoration: codeBlockLine });
  }

  // Copy button widget at end of opening fence line
  ranges.push({
    from: openLine.to,
    to: openLine.to,
    decoration: Decoration.widget({
      widget: new CopyButtonWidget(codeContent),
      side: 1,
    }),
  });
}
