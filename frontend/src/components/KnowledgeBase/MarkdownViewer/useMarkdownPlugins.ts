/**
 * Memoized remark/rehype plugin arrays for the markdown rendering pipeline.
 *
 * Plugin order is CRITICAL for security:
 * 1. remarkWikilink -- transforms [[wikilink]] syntax into standard link nodes
 * 2. rehypeCallouts -- transforms blockquote callout syntax into HTML structure
 * 3. rehypeSanitize -- strips disallowed elements/attributes (SEC-01 layer 2)
 * 4. rehypeHighlight -- applies syntax highlighting (trusted, runs after sanitize)
 *
 * Plugins are memoized to prevent unnecessary re-renders of ReactMarkdown
 * when parent components update.
 */
import { useMemo } from "react";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeCallouts from "rehype-callouts";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { sanitizeSchema } from "./sanitize";
import { remarkWikilink } from "./remarkWikilink";
import type { PluggableList } from "unified";

/**
 * Returns stable, memoized remark and rehype plugin arrays.
 *
 * @param resolveLink - Optional resolver for wikilink targets. If provided,
 *   the remarkWikilink plugin uses it to map targets to URLs. Default
 *   produces `#wikilink:<target>` fragment hrefs.
 * @returns Object with remarkPlugins and rehypePlugins arrays,
 *          safe to pass directly to ReactMarkdown props.
 */
export function useMarkdownPlugins(
  resolveLink?: (target: string) => string | null,
): {
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
} {
  const remarkPlugins: PluggableList = useMemo(
    () => [
      remarkGfm,
      remarkFrontmatter,
      // Transform [[wikilinks]] into standard link nodes
      resolveLink
        ? [remarkWikilink, { resolveLink }]
        : remarkWikilink,
    ],
    [resolveLink],
  );

  const rehypePlugins: PluggableList = useMemo(
    () => [
      // 1. Transform callout blockquotes into structured HTML
      [rehypeCallouts, { theme: "obsidian" as const }],
      // 2. Sanitize: strip anything not in our allowlist (SEC-01)
      [rehypeSanitize, sanitizeSchema],
      // 3. Highlight code blocks (trusted plugin, runs post-sanitize)
      rehypeHighlight,
    ],
    [],
  );

  return { remarkPlugins, rehypePlugins };
}
