/**
 * Inline formatting decoration builder for Live Preview.
 *
 * Handles bold (StrongEmphasis), italic (Emphasis), strikethrough
 * (Strikethrough), and inline code (InlineCode) by:
 * 1. Hiding delimiter marks via replace decorations
 * 2. Styling content between delimiters via mark decorations
 *
 * Nested emphasis (e.g. ***bold italic***) is handled naturally:
 * the lezer parser produces nested StrongEmphasis > Emphasis nodes,
 * and each is decorated independently. CSS classes stack correctly.
 */
import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { DecorationRange } from "../types";

/** Replace decoration that hides matched content (zero-width). */
const hiddenReplace = Decoration.replace({});

/** Pre-created mark decorations for inline formatting. */
const boldMark = Decoration.mark({ class: "cm-lp-bold" });
const italicMark = Decoration.mark({ class: "cm-lp-italic" });
const strikethroughMark = Decoration.mark({ class: "cm-lp-strikethrough" });
const codeMark = Decoration.mark({ class: "cm-lp-code" });

/**
 * Decorate an inline formatting node: hide syntax delimiters and
 * style the content between them.
 */
export function decorateInline(
  node: SyntaxNodeRef,
  ranges: DecorationRange[],
): void {
  switch (node.name) {
    case "StrongEmphasis":
      decorateEmphasis(node, ranges, boldMark);
      break;
    case "Emphasis":
      decorateEmphasis(node, ranges, italicMark);
      break;
    case "Strikethrough":
      decorateStrikethrough(node, ranges);
      break;
    case "InlineCode":
      decorateInlineCode(node, ranges);
      break;
  }
}

/**
 * Shared logic for StrongEmphasis and Emphasis nodes.
 * Both use EmphasisMark children for their delimiters.
 */
function decorateEmphasis(
  node: SyntaxNodeRef,
  ranges: DecorationRange[],
  contentDeco: Decoration,
): void {
  const marks = node.node.getChildren("EmphasisMark");
  if (marks.length < 2) return;

  const firstMark = marks[0];
  const lastMark = marks[marks.length - 1];

  // Hide delimiter marks (** or *)
  for (const mark of marks) {
    ranges.push({ from: mark.from, to: mark.to, decoration: hiddenReplace });
  }

  // Style content between first and last delimiter
  if (firstMark.to < lastMark.from) {
    ranges.push({
      from: firstMark.to,
      to: lastMark.from,
      decoration: contentDeco,
    });
  }
}

/**
 * Strikethrough uses StrikethroughMark children for ~~ delimiters.
 * Requires GFM parser support (markdownLanguage, not commonmarkLanguage).
 */
function decorateStrikethrough(
  node: SyntaxNodeRef,
  ranges: DecorationRange[],
): void {
  const marks = node.node.getChildren("StrikethroughMark");
  if (marks.length < 2) return;

  const firstMark = marks[0];
  const lastMark = marks[marks.length - 1];

  // Hide ~~ delimiters
  for (const mark of marks) {
    ranges.push({ from: mark.from, to: mark.to, decoration: hiddenReplace });
  }

  // Style content between delimiters
  if (firstMark.to < lastMark.from) {
    ranges.push({
      from: firstMark.to,
      to: lastMark.from,
      decoration: strikethroughMark,
    });
  }
}

/**
 * InlineCode uses CodeMark children (backticks) and CodeText child (content).
 */
function decorateInlineCode(
  node: SyntaxNodeRef,
  ranges: DecorationRange[],
): void {
  const codeMarks = node.node.getChildren("CodeMark");
  if (codeMarks.length === 0) return;

  // Hide backtick delimiters
  for (const mark of codeMarks) {
    ranges.push({ from: mark.from, to: mark.to, decoration: hiddenReplace });
  }

  // Style the code content
  const codeText = node.node.getChild("CodeText");
  if (codeText) {
    ranges.push({
      from: codeText.from,
      to: codeText.to,
      decoration: codeMark,
    });
  }
}
