/**
 * Base theme for Live Preview CSS classes.
 *
 * Uses EditorView.baseTheme() so the existing obsidianTheme
 * (higher priority) can override any defaults here.
 *
 * These classes are applied by Live Preview decorations when the
 * cursor is away from a line. The existing obsidianTheme classes
 * (.cm-header-*, .cm-strong, .cm-em, etc.) still apply when the
 * cursor IS on the line (raw markdown visible).
 */
import { EditorView } from "@codemirror/view";

export const livePreviewBaseTheme = EditorView.baseTheme({
  /* ── Headings ─────────────────────────────────────────────── */
  ".cm-lp-h1": {
    fontSize: "1.6em",
    fontWeight: "700",
    lineHeight: "1.3",
    color: "#f4f6fa",
  },
  ".cm-lp-h2": {
    fontSize: "1.4em",
    fontWeight: "600",
    lineHeight: "1.3",
    color: "#f4f6fa",
  },
  ".cm-lp-h3": {
    fontSize: "1.2em",
    fontWeight: "600",
    lineHeight: "1.4",
    color: "#f4f6fa",
  },
  ".cm-lp-h4": {
    fontSize: "1.1em",
    fontWeight: "600",
    lineHeight: "1.4",
    color: "#f4f6fa",
  },
  ".cm-lp-h5": {
    fontSize: "1.05em",
    fontWeight: "600",
    lineHeight: "1.5",
    color: "#f4f6fa",
  },
  ".cm-lp-h6": {
    fontSize: "1em",
    fontWeight: "600",
    lineHeight: "1.5",
    color: "#e4e7ec",
  },

  /* ── Inline formatting ────────────────────────────────────── */
  ".cm-lp-bold": {
    fontWeight: "700",
    color: "#f4f6fa",
  },
  ".cm-lp-italic": {
    fontStyle: "italic",
  },
  ".cm-lp-strikethrough": {
    textDecoration: "line-through",
    color: "#9ca3af",
  },
  ".cm-lp-code": {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: "0.9em",
    backgroundColor: "rgba(110, 118, 129, 0.15)",
    borderRadius: "3px",
    padding: "1px 4px",
  },

  /* ── Links ────────────────────────────────────────────────── */
  ".cm-lp-link": {
    color: "#3b82f6",
    textDecoration: "underline",
    cursor: "pointer",
  },

  /* ── Highlight ───────────────────────────────────────────── */
  ".cm-lp-highlight": {
    backgroundColor: "rgba(250, 204, 21, 0.25)",
    borderRadius: "3px",
    padding: "1px 2px",
  },

  /* ── Wikilinks ──────────────────────────────────────────── */
  ".cm-lp-wikilink": {},
  ".cm-lp-wikilink-broken": {
    color: "#f85149",
    textDecoration: "underline wavy",
  },

  /* ── Block elements ───────────────────────────────────────── */
  ".cm-lp-blockquote": {
    borderLeft: "3px solid #0ea5e9",
    paddingLeft: "12px",
    color: "#9ca3af",
  },
  ".cm-lp-codeblock": {
    backgroundColor: "rgba(110, 118, 129, 0.1)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: "0.9em",
    paddingLeft: "16px",
    paddingRight: "16px",
  },
  ".cm-lp-codeblock-first": {
    borderTopLeftRadius: "6px",
    borderTopRightRadius: "6px",
    paddingTop: "8px",
    lineHeight: "0",
    position: "relative",
  },
  ".cm-lp-codeblock-last": {
    borderBottomLeftRadius: "6px",
    borderBottomRightRadius: "6px",
    paddingBottom: "8px",
    lineHeight: "0",
  },
  ".cm-lp-copy-btn": {
    position: "absolute",
    right: "8px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    color: "#9ca3af",
    cursor: "pointer",
    padding: "4px",
    borderRadius: "4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0.6",
    transition: "opacity 0.2s",
  },
  ".cm-lp-copy-btn:hover": {
    opacity: "1",
    backgroundColor: "rgba(110, 118, 129, 0.2)",
  },

  /* ── List markers ────────────────────────────────────────── */
  ".cm-lp-bullet": {
    color: "#0ea5e9",
    fontSize: "1.2em",
    lineHeight: "1",
    display: "inline-block",
    width: "1em",
    textAlign: "center",
  },
  ".cm-lp-list-number": {
    color: "#0ea5e9",
    fontWeight: "600",
  },

  /* ── Widgets ──────────────────────────────────────────────── */
  ".cm-lp-hr": {
    borderTop: "1px solid #252b3a",
    margin: "8px 0",
    display: "block",
  },
  ".cm-lp-image": {
    maxWidth: "100%",
    maxHeight: "400px",
    borderRadius: "4px",
    display: "block",
    objectFit: "contain",
  },
  ".cm-lp-image-wrapper": {
    padding: "4px 0", // Use padding, NOT margin (Pitfall 3)
    lineHeight: "0", // Prevent extra space from inline-block
  },
  ".cm-lp-image-loading": {
    minHeight: "60px",
    background: "rgba(110, 118, 129, 0.08)",
    borderRadius: "4px",
  },
  ".cm-lp-image-loaded": {
    background: "none",
    minHeight: "unset",
  },
  ".cm-lp-image-error": {
    minHeight: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ".cm-lp-image-error-text": {
    color: "#9ca3af",
    fontSize: "0.85em",
    fontStyle: "italic",
  },
  ".cm-lp-checkbox": {
    marginRight: "4px",
    verticalAlign: "middle",
    cursor: "pointer",
    accentColor: "#0ea5e9",
  },
  ".cm-lp-task-checked": {
    textDecoration: "line-through",
    color: "#9ca3af",
    opacity: "0.7",
  },

  /* ── Hidden syntax (for mark-based hiding if needed) ────── */
  ".cm-lp-hidden": {
    fontSize: "0",
  },
});
