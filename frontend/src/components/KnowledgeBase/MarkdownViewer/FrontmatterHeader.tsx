/**
 * FrontmatterHeader -- Structured display of YAML frontmatter metadata.
 *
 * Renders title, date, clickable tag pills, and all remaining
 * key-value fields from the document's frontmatter. Pentest notes
 * often have custom YAML keys (target, scope, methodology) that
 * must display as generic rows.
 */
import { normalizeTags } from "@/lib/tagUtils";

interface FrontmatterHeaderProps {
  frontmatter: Record<string, unknown>;
  onTagClick?: (tag: string) => void;
  hideTitle?: boolean;
  hideTags?: boolean;
}

/** Format a date value for display. */
function formatDate(raw: unknown): string | null {
  if (!raw) return null;
  const str = String(raw);
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Format an arbitrary value for display. */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (Array.isArray(val)) return val.map(String).join(", ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

const KNOWN_KEYS = new Set(["title", "tags", "date"]);

export function FrontmatterHeader({ frontmatter, onTagClick, hideTitle, hideTags }: FrontmatterHeaderProps) {
  const title = frontmatter.title as string | undefined;
  const date = formatDate(frontmatter.date);
  const tags = normalizeTags(frontmatter.tags);
  const otherKeys = Object.entries(frontmatter).filter(([k]) => !KNOWN_KEYS.has(k));

  return (
    <div
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
        borderRadius: "6px",
        padding: "1.25rem",
        marginBottom: "1.5rem",
      }}
    >
      {title && !hideTitle && (
        <h1 style={{ color: "var(--color-text-primary)", fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>
          {title}
        </h1>
      )}

      {date && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem", margin: "0 0 0.75rem" }}>
          {date}
        </p>
      )}

      {tags.length > 0 && !hideTags && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: otherKeys.length > 0 ? "0.75rem" : 0 }}>
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick?.(tag)}
              style={{
                backgroundColor: "rgba(163, 113, 247, 0.15)",
                color: "var(--color-accent-purple)",
                border: "none",
                borderRadius: "9999px",
                padding: "0.2em 0.75em",
                fontSize: "0.8rem",
                fontWeight: 500,
                cursor: "pointer",
                transition: "background-color 0.15s ease",
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {otherKeys.length > 0 && (
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem", marginTop: title || date || tags.length > 0 ? "0.25rem" : 0 }}>
          {otherKeys.map(([key, val]) => (
            <div key={key} style={{ display: "flex", gap: "0.5rem", fontSize: "0.875rem", marginBottom: "0.35rem" }}>
              <span style={{ color: "var(--color-text-muted)", fontWeight: 500, minWidth: "6rem" }}>{key}:</span>
              <span style={{ color: "var(--color-text-secondary)" }}>{formatValue(val)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
