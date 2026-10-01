/**
 * Custom lezer MarkdownConfig that parses ==text== into Highlight
 * and HighlightMark nodes.
 *
 * Modeled on the built-in Strikethrough extension from @lezer/markdown.
 * Uses `cx.addDelimiter()` with standard open/close flanking rules
 * so that `==highlighted text==` produces:
 *
 *   Highlight
 *     HighlightMark  (opening ==)
 *     ...content...
 *     HighlightMark  (closing ==)
 */
import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

/**
 * Unicode punctuation regex for flanking delimiter detection.
 * Copied from the @lezer/markdown internals (Strikethrough uses
 * the same pattern).
 */
const Punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1\u2010-\u2027]/;

/** Delimiter type that resolves matched pairs into Highlight nodes. */
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

/**
 * MarkdownConfig extension that adds ==highlight== syntax.
 *
 * Usage:
 *   markdown({ base: markdownLanguage, extensions: [HighlightExtension] })
 */
export const HighlightExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "Highlight",
      style: { "Highlight/...": tags.special(tags.emphasis) },
    },
    {
      name: "HighlightMark",
      style: tags.processingInstruction,
    },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        // Must be exactly 2 consecutive '=' (charCode 61), not 3+
        if (
          next !== 61 ||
          cx.char(pos + 1) !== 61 ||
          cx.char(pos + 2) === 61
        ) {
          return -1;
        }

        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = Punctuation.test(before);
        const pAfter = Punctuation.test(after);

        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore), // can open
          !sBefore && (!pBefore || sAfter || pAfter), // can close
        );
      },
      after: "Emphasis",
    },
  ],
};
