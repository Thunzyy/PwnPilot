/**
 * MarkdownViewer -- Main markdown rendering component.
 *
 * Orchestrates the full pipeline:
 * 1. DOMPurify pre-sanitization (SEC-01 layer 1)
 * 2. react-markdown with remark/rehype plugin chain (including remarkWikilink)
 * 3. Custom CodeBlock for syntax-highlighted code with copy + line numbers
 * 4. WikiLink component override for [[wikilink]] navigation
 * 5. FrontmatterHeader for structured metadata display
 *
 * Max content width ~900px with prose typography scoped under
 * the `.markdown-viewer` class (styles in CalloutStyles.css).
 */
import { type ReactNode, useMemo } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import type { KBDocDetail } from "@/types/kb";
import { useMarkdownPlugins } from "./useMarkdownPlugins";
import { sanitizeMarkdown } from "./sanitize";
import { CodeBlock } from "./CodeBlock";
import { ReportAttackGraphEmbed } from "./ReportAttackGraphEmbed";
import { WikiLink } from "./WikiLink";
import { FrontmatterHeader } from "./FrontmatterHeader";
import "./CalloutStyles.css";
import "./PrintStyles.css";

interface MarkdownViewerProps {
  doc: KBDocDetail;
  onTagClick?: (tag: string) => void;
  /** Callback when a [[wikilink]] is clicked. Receives the target string. */
  onWikilinkClick?: (target: string) => void;
  /** Optional resolver mapping wikilink targets to URLs (null = broken). */
  resolveLink?: (target: string) => string | null;
}

function extractTextContent(node: ReactNode): string {
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number") {
    return String(node);
  }
  if (!node) {
    return "";
  }
  if (Array.isArray(node)) {
    return node.map(extractTextContent).join("");
  }
  if (typeof node === "object" && "props" in node) {
    return extractTextContent((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function isReportMarkdownPath(relativePath: string | null | undefined): boolean {
  if (!relativePath) {
    return false;
  }
  return /(^|[\\/])report\.md$/i.test(relativePath);
}

function isAttackGraphImageReference(src: unknown): boolean {
  if (typeof src !== "string") {
    return false;
  }

  const withoutFragment = src.split("#", 1)[0] ?? "";
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? "";
  const normalizedPath = withoutQuery.replace(/\\/g, "/").toLowerCase();
  return ["attack-graph.svg", "attack-graph.png"].includes(
    normalizedPath.split("/").at(-1) ?? "",
  );
}

function isAttackGraphImageParagraph(node: unknown): boolean {
  const children = (node as { children?: unknown[] } | null)?.children;
  if (!Array.isArray(children) || children.length !== 1) {
    return false;
  }

  const [child] = children as Array<{
    tagName?: string;
    properties?: Record<string, unknown>;
  }>;

  return child?.tagName === "img" && isAttackGraphImageReference(child.properties?.src);
}

export function MarkdownViewer({
  doc,
  onTagClick,
  onWikilinkClick,
  resolveLink,
}: MarkdownViewerProps) {
  const { remarkPlugins, rehypePlugins } = useMarkdownPlugins(resolveLink);
  const cleanBody = sanitizeMarkdown(doc.body ?? "");
  const isReportDoc = isReportMarkdownPath(doc.relative_path);
  const reportProjectId = doc.source?.project_id ?? null;

  const components: Components = useMemo(
    () => ({
      pre: CodeBlock,
      p: ({ node, children, ...props }) => {
        if (isReportDoc && reportProjectId && isAttackGraphImageParagraph(node)) {
          return <ReportAttackGraphEmbed projectId={reportProjectId} />;
        }

        return <p {...props}>{children}</p>;
      },
      h2: ({ children, node, ...props }) => {
        void node;
        const headingText = extractTextContent(children).trim().toLowerCase();
        const shouldEmbedAttackGraph =
          isReportDoc &&
          reportProjectId &&
          headingText === "attack path";

        return (
          <>
            <h2 {...props}>{children}</h2>
            {shouldEmbedAttackGraph ? (
              <ReportAttackGraphEmbed projectId={reportProjectId} />
            ) : null}
          </>
        );
      },
      img: ({ src, alt, node, ...props }) => {
        void node;
        if (isReportDoc && reportProjectId && isAttackGraphImageReference(src)) {
          return <ReportAttackGraphEmbed projectId={reportProjectId} />;
        }

        return <img src={src} alt={alt} {...props} />;
      },
      a: ({ href, children, node, ...props }) => {
        void node;
        // Broken wikilink: #wikilink:broken:<target>
        if (href?.startsWith("#wikilink:broken:")) {
          const target = href.replace("#wikilink:broken:", "");
          return (
            <WikiLink target={target} isBroken>
              {children}
            </WikiLink>
          );
        }
        // Valid wikilink: #wikilink:<target>
        if (href?.startsWith("#wikilink:")) {
          const target = href.replace("#wikilink:", "");
          return (
            <WikiLink target={target} onNavigate={onWikilinkClick}>
              {children}
            </WikiLink>
          );
        }
        // Regular external link
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      },
    }),
    [isReportDoc, onWikilinkClick, reportProjectId],
  );

  const hasFrontmatter =
    doc.frontmatter !== null &&
    doc.frontmatter !== undefined &&
    Object.keys(doc.frontmatter).length > 0;

  return (
    <article
      className="markdown-viewer"
      style={{
        maxWidth: isReportDoc ? "none" : "900px",
        margin: "0 auto",
        padding: "1.5rem",
      }}
    >
      {hasFrontmatter && (
        <FrontmatterHeader
          frontmatter={doc.frontmatter!}
          onTagClick={onTagClick}
          hideTitle
          hideTags
        />
      )}

      {cleanBody ? (
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {cleanBody}
        </Markdown>
      ) : (
        <p style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
          No content available.
        </p>
      )}
    </article>
  );
}
