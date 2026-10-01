import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { imagePreviewField } from "../codemirror/livePreview/imageField";

function countDecorations(state: EditorState) {
  let count = 0;
  state.field(imagePreviewField).between(0, state.doc.length, () => {
    count += 1;
  });
  return count;
}

describe("imagePreviewField", () => {
  it("rebuilds image previews when the cursor moves onto an image line", () => {
    const state = EditorState.create({
      doc: "![[proof.png]]\nnext",
      selection: { anchor: 15 },
      extensions: [markdown(), imagePreviewField],
    });

    expect(countDecorations(state)).toBe(1);

    const nextState = state.update({
      selection: { anchor: 5 },
    }).state;

    expect(countDecorations(nextState)).toBe(0);
  });
});
