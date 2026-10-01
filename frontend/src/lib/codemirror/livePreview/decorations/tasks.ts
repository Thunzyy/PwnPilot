/**
 * Task checkbox decoration builder for Live Preview.
 *
 * When the cursor is outside the task item line:
 * - The ListMark (- or *) and trailing space are hidden
 * - The TaskMarker ([ ] or [x]) is replaced with a clickable checkbox widget
 * - Checked tasks get strikethrough/muted styling on the text content
 *
 * Clicking a checkbox dispatches a CM6 transaction that toggles the
 * character inside the brackets (space <-> x), enabling undo/redo.
 *
 * The click event is handled by domEventHandlers in index.ts, NOT
 * inside the widget. CheckboxWidget.ignoreEvent() returns false to
 * let events propagate to the editor's event handlers.
 */
import { Decoration, WidgetType, type EditorView } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { EditorState } from "@codemirror/state";
import type { DecorationRange } from "../types";

const hiddenReplace = Decoration.replace({});
const checkedTaskMark = Decoration.mark({ class: "cm-lp-task-checked" });

/** Checkbox widget rendered in place of [ ] or [x] task markers. */
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  toDOM(): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-lp-checkbox";
    input.setAttribute(
      "aria-label",
      this.checked ? "Completed task" : "Incomplete task",
    );
    return input;
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked;
  }

  // Return false = "don't ignore" = let the event propagate to
  // domEventHandlers in index.ts where toggleTaskCheckbox handles it.
  // Opposite of CopyButtonWidget which returns true to handle internally.
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Toggle a task checkbox by dispatching a CM6 transaction.
 *
 * Finds the [ ] or [x]/[X] marker on the line at `pos` and replaces
 * the character inside the brackets. Because this uses view.dispatch,
 * the change integrates with CM6's undo/redo history automatically.
 */
export function toggleTaskCheckbox(view: EditorView, pos: number): void {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;

  // Look for unchecked [ ] first
  const uncheckedIdx = text.indexOf("[ ]");
  if (uncheckedIdx !== -1) {
    // Replace the space inside brackets with x
    const charFrom = line.from + uncheckedIdx + 1;
    view.dispatch({
      changes: { from: charFrom, to: charFrom + 1, insert: "x" },
    });
    return;
  }

  // Look for checked [x] or [X]
  const checkedLower = text.indexOf("[x]");
  const checkedUpper = text.indexOf("[X]");
  const checkedIdx =
    checkedLower !== -1
      ? checkedLower
      : checkedUpper !== -1
        ? checkedUpper
        : -1;
  if (checkedIdx !== -1) {
    // Replace x/X inside brackets with space
    const charFrom = line.from + checkedIdx + 1;
    view.dispatch({
      changes: { from: charFrom, to: charFrom + 1, insert: " " },
    });
  }
}

/**
 * Decorate a Task node: hide the ListMark, replace TaskMarker with
 * a checkbox widget, and apply strikethrough to checked task text.
 *
 * The `node` parameter is the Task child of a ListItem, NOT the
 * ListItem itself. The caller (livePreviewPlugin.ts) extracts the
 * Task child before calling this function.
 */
export function decorateTask(
  node: SyntaxNodeRef,
  state: EditorState,
  ranges: DecorationRange[],
): void {
  const taskMarker = node.node.getChild("TaskMarker");
  if (!taskMarker) return;

  const doc = state.doc;
  const line = doc.lineAt(taskMarker.from);
  const markerText = doc.sliceString(taskMarker.from, taskMarker.to);
  const checked = markerText.includes("x") || markerText.includes("X");

  // Hide the ListMark (- or *) and trailing space from the parent ListItem
  const listMark = node.node.parent?.getChild("ListMark");
  if (listMark) {
    ranges.push({
      from: listMark.from,
      to: Math.min(listMark.to + 1, line.to),
      decoration: hiddenReplace,
    });
  }

  // Replace TaskMarker [ ]/[x] with checkbox widget
  ranges.push({
    from: taskMarker.from,
    to: taskMarker.to,
    decoration: Decoration.replace({
      widget: new CheckboxWidget(checked),
    }),
  });

  // For checked tasks, apply strikethrough/muted styling to the text
  // content after the TaskMarker (skip the space after the marker)
  if (checked && taskMarker.to + 1 < line.to) {
    ranges.push({
      from: taskMarker.to + 1,
      to: line.to,
      decoration: checkedTaskMark,
    });
  }
}
