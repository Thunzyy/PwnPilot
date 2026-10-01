/**
 * KBMarkdownEditor -- CodeMirror 6 markdown editor styled like Obsidian.
 *
 * Reads from and writes to the kbStore editBuffers so that
 * unsaved edits survive tab switches (EDIT-07). Initializes
 * the buffer from the doc body on first render if no buffer exists.
 *
 * Styled to blend seamlessly with the reading view — no line numbers,
 * no gutter, transparent background matching the app's dark theme.
 * Ctrl+F / Ctrl+H for find/replace still works via basicSetup.
 */
import { useCallback, useEffect, useMemo } from "react";

import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";

import { useKBStore } from "@/stores/kbStore";
import { livePreview } from "@/lib/codemirror/livePreview";
import { HighlightExtension } from "@/lib/codemirror/livePreview/highlightExtension";
import { buildDocLookup, resolveWikilink } from "@/lib/wikilinkResolver";

/** Custom dark theme matching the app background */
const obsidianTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "#e4e7ec",
      fontSize: "16px",
      lineHeight: "1.7",
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    },
    ".cm-content": {
      caretColor: "#0ea5e9",
      padding: "0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#0ea5e9",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "rgba(163, 114, 248, 0.2)",
      },
    ".cm-activeLine": {
      backgroundColor: "rgba(163, 114, 248, 0.05)",
    },
    ".cm-gutters": {
      display: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "rgba(163, 114, 248, 0.15)",
      border: "none",
      color: "#0ea5e9",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    /* Markdown syntax highlighting */
    ".cm-header-1": { fontSize: "1.6em", fontWeight: "700", color: "#f4f6fa" },
    ".cm-header-2": { fontSize: "1.4em", fontWeight: "600", color: "#f4f6fa" },
    ".cm-header-3": { fontSize: "1.2em", fontWeight: "600", color: "#f4f6fa" },
    ".cm-header-4": { fontSize: "1.1em", fontWeight: "600", color: "#f4f6fa" },
    ".cm-header-5": { fontSize: "1.05em", fontWeight: "600", color: "#f4f6fa" },
    ".cm-header-6": { fontSize: "1em", fontWeight: "600", color: "#e4e7ec" },
    ".cm-link": { color: "#3b82f6", textDecoration: "underline" },
    ".cm-url": { color: "#9ca3af" },
    ".cm-strong": { fontWeight: "700", color: "#f4f6fa" },
    ".cm-em": { fontStyle: "italic", color: "#e4e7ec" },
    ".cm-strikethrough": {
      textDecoration: "line-through",
      color: "#9ca3af",
    },
    ".cm-monospace": {
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: "0.9em",
      backgroundColor: "rgba(110, 118, 129, 0.15)",
      borderRadius: "3px",
      padding: "1px 4px",
    },
    /* Search panel styling */
    ".cm-panels": {
      backgroundColor: "#121722",
      borderBottom: "1px solid #252b3a",
      color: "#e4e7ec",
    },
    ".cm-panels .cm-button": {
      backgroundColor: "#242b3e",
      color: "#e4e7ec",
      border: "1px solid #252b3a",
    },
    ".cm-panels .cm-textfield": {
      backgroundColor: "#0b0f17",
      color: "#f4f6fa",
      border: "1px solid #252b3a",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgba(250, 204, 21, 0.25)",
    },
    ".cm-searchMatch-selected": {
      backgroundColor: "rgba(250, 204, 21, 0.55)",
    },
  },
  { dark: true },
);

/** Minimal setup without line numbers, keeping useful keybindings */
const minimalSetup = [
  history(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  foldGutter(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    indentWithTab,
  ]),
];

interface KBMarkdownEditorProps {
  docId: string;
  initialContent: string;
}

export function KBMarkdownEditor({
  docId,
  initialContent,
}: KBMarkdownEditorProps) {
  const editBuffer = useKBStore((s) => s.editBuffers[docId]);
  const setEditBuffer = useKBStore((s) => s.setEditBuffer);
  const treesPerSource = useKBStore((s) => s.treesPerSource);
  const docCache = useKBStore((s) => s.docCache);
  const navigateToDoc = useKBStore((s) => s.navigateToDoc);

  // Initialize buffer from doc body on first render
  useEffect(() => {
    if (editBuffer === undefined) {
      setEditBuffer(docId, initialContent);
    }
  }, [docId, editBuffer, initialContent, setEditBuffer]);

  // Build doc lookup from all loaded source trees for wikilink resolution
  const docLookup = useMemo(() => {
    const entries = Object.values(treesPerSource);
    if (entries.length === 0) return new Map();
    // Merge lookups from all source trees
    const merged = new Map<string, import("@/types/kb").KBTreeDocItem[]>();
    for (const tree of entries) {
      const lookup = buildDocLookup(tree);
      for (const [stem, docs] of lookup) {
        const existing = merged.get(stem);
        if (existing) {
          existing.push(...docs);
        } else {
          merged.set(stem, [...docs]);
        }
      }
    }
    return merged;
  }, [treesPerSource]);

  // Current document's relative path for same-directory preference
  const currentPath = docCache[docId]?.relative_path;

  // Wikilink resolver callback
  const resolver = useCallback(
    (target: string) => resolveWikilink(target, docLookup, currentPath),
    [docLookup, currentPath],
  );

  // Wikilink navigator callback
  const wikilinkNavigator = useCallback(
    (target: string) => {
      const id = resolveWikilink(target, docLookup, currentPath);
      if (id) {
        const cached = useKBStore.getState().docCache[id];
        navigateToDoc(id, cached?.title ?? target);
      }
    },
    [docLookup, currentPath, navigateToDoc],
  );

  // Memoize extensions -- deps include resolver/navigator since they
  // change when treeData changes. @uiw/react-codemirror handles
  // extension array changes by reconfiguring (not remounting).
  const extensions = useMemo(
    () => [
      ...minimalSetup,
      markdown({ base: markdownLanguage, extensions: [HighlightExtension] }),
      EditorView.lineWrapping,
      livePreview({
        resolveWikilink: resolver,
        onWikilinkClick: wikilinkNavigator,
        onLinkClick: (url: string) => window.open(url, "_blank"),
      }),
    ],
    [resolver, wikilinkNavigator],
  );

  // Memoize onChange to keep stable reference
  const handleChange = useCallback(
    (value: string) => {
      setEditBuffer(docId, value);
    },
    [docId, setEditBuffer],
  );

  return (
    <div
      className="flex flex-1 flex-col"
      style={{ maxWidth: "900px", margin: "0 auto", width: "100%" }}
    >
      <CodeMirror
        value={editBuffer ?? initialContent}
        onChange={handleChange}
        extensions={extensions}
        theme={obsidianTheme}
        basicSetup={false}
        autoFocus
      />
    </div>
  );
}
