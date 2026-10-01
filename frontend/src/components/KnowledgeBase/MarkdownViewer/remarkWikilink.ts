/**
 * remarkWikilink -- Custom remark plugin for [[wikilink]] syntax.
 *
 * Walks the MDAST tree looking for text nodes containing [[target]] or
 * [[target|display text]] patterns. Splits those text nodes into a mix
 * of plain text and standard link nodes.
 *
 * Key design decision: Links use `#wikilink:<target>` as their href.
 * This is a fragment URL that passes through rehype-sanitize's default
 * schema without any modifications -- no custom attributes needed.
 *
 * Broken links (resolveLink returns null) use `#wikilink:broken:<target>`
 * so the WikiLink component can detect and style them distinctly.
 *
 * Regex matches the backend markdown_parser.py pattern exactly.
 */
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Text, Link, PhrasingContent } from "mdast";

/** Regex matching [[target]] and [[target|display text]] wikilinks. */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export interface RemarkWikilinkOptions {
  /**
   * Resolve a wikilink target to a URL string.
   * Return null for broken/unresolvable links.
   * Default: `#wikilink:<target>`
   */
  resolveLink?: (target: string) => string | null;
}

/**
 * Remark plugin that transforms [[wikilink]] syntax into standard
 * MDAST link nodes that survive the rehype-sanitize pipeline.
 */
export const remarkWikilink: Plugin<[RemarkWikilinkOptions?], Root> = (
  options = {},
) => {
  const resolve =
    options.resolveLink ??
    ((target: string) => `#wikilink:${target}`);

  return (tree) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined) return;

      const { value } = node;

      // Reset lastIndex before test (global flag retains state)
      WIKILINK_RE.lastIndex = 0;
      if (!WIKILINK_RE.test(value)) return;

      // Reset again before matchAll iteration
      WIKILINK_RE.lastIndex = 0;

      const children: PhrasingContent[] = [];
      let lastIndex = 0;

      for (const match of value.matchAll(WIKILINK_RE)) {
        const [full, target, display] = match;
        const start = match.index!;

        // Text before the wikilink
        if (start > lastIndex) {
          children.push({ type: "text", value: value.slice(lastIndex, start) });
        }

        // Resolve the wikilink target
        const trimmedTarget = target.trim();
        const href = resolve(trimmedTarget);

        // Build a standard link node
        const linkNode: Link = {
          type: "link",
          url: href ?? `#wikilink:broken:${trimmedTarget}`,
          children: [
            { type: "text", value: display?.trim() || trimmedTarget },
          ],
        };

        children.push(linkNode);
        lastIndex = start + full.length;
      }

      // Remaining text after last match
      if (lastIndex < value.length) {
        children.push({ type: "text", value: value.slice(lastIndex) });
      }

      // Replace the original text node with the split children
      parent.children.splice(index, 1, ...children);
    });
  };
};
