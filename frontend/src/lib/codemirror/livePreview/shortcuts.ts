/**
 * Formatting keyboard shortcuts for Live Preview mode.
 *
 * Provides standard markdown editor keybindings:
 *   - Mod-b: Toggle bold (**) markers around selection
 *   - Mod-i: Toggle italic (*) markers around selection
 *   - Mod-k: Wrap selection in [text](url) link template
 *
 * All commands use changeByRange for multi-cursor support and
 * return true to prevent browser default contenteditable behavior
 * (which would apply visual bold/italic without markdown markers).
 */
import { EditorSelection, type StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";

/**
 * Creates a StateCommand that toggles a marker around the current selection.
 *
 * If the selection is already surrounded by the marker, removes it (toggle off).
 * Otherwise, wraps the selection with the marker (toggle on).
 */
function wrapSelection(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const len = marker.length;
      const before = state.sliceDoc(range.from - len, range.from);
      const after = state.sliceDoc(range.to, range.to + len);

      if (before === marker && after === marker) {
        // Toggle OFF: remove surrounding markers
        return {
          changes: [
            { from: range.from - len, to: range.from, insert: "" },
            { from: range.to, to: range.to + len, insert: "" },
          ],
          range: EditorSelection.range(
            range.from - len,
            range.to - len,
          ),
        };
      }

      // Toggle ON: add markers around selection
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(
          range.from + len,
          range.to + len,
        ),
      };
    });
    dispatch(state.update(changes, { scrollIntoView: true }));
    return true; // Prevent browser default (no visual bold/italic)
  };
}

/**
 * Wraps the current selection in a markdown link template: [text](url).
 * After insertion, the cursor selects "url" for immediate replacement.
 */
const linkCommand: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const insert = `[${selected}](url)`;
    return {
      changes: { from: range.from, to: range.to, insert },
      // Place cursor selecting "url" for easy replacement
      range: EditorSelection.range(
        range.from + selected.length + 2, // after `[text](`
        range.from + selected.length + 5, // selects "url"
      ),
    };
  });
  dispatch(state.update(changes, { scrollIntoView: true }));
  return true; // Prevent browser default
};

/** Formatting keymap: Ctrl+B bold, Ctrl+I italic, Ctrl+K link. */
export const formattingKeymap = keymap.of([
  { key: "Mod-b", run: wrapSelection("**") },
  { key: "Mod-i", run: wrapSelection("*") },
  { key: "Mod-k", run: linkCommand },
]);
