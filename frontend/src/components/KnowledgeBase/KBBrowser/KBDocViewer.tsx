/**
 * KBDocViewer -- Pane-aware document viewer composing breadcrumbs,
 * MarkdownViewer with wikilink resolution, and backlinks panel.
 *
 * Reads the active document from the current pane via PaneContext.
 * Resolves wikilinks via the stem-based doc lookup, and wires tag click /
 * wikilink navigation callbacks through to leaf components.
 */
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import yaml from "js-yaml";

import { useKBStore } from "@/stores/kbStore";
import { buildDocLookup, resolveWikilink } from "@/lib/wikilinkResolver";
import { LazyBoundary } from "@/components/Layout/LazyBoundary";
import { normalizeTags } from "@/lib/tagUtils";
import { usePaneId } from "../PaneContext";
import { KBFindBar } from "../KBFindBar";
import { KBNavBar } from "./KBNavBar";
import { InlineTitle } from "./InlineTitle";
import { KBNewTabPage } from "./KBNewTabPage";
import { BacklinkPanel } from "./BacklinkPanel";
import { TagFilter } from "./TagFilter";
import { UsedInPanel } from "./UsedInPanel";
import { TagPill } from "./TagPill";
import { AddTagButton } from "./AddTagButton";

const MarkdownViewerContent = lazy(async () => ({
  default: (await import("../MarkdownViewer/MarkdownViewer")).MarkdownViewer,
}));

const MarkdownEditorContent = lazy(async () => ({
  default: (await import("./KBMarkdownEditor")).KBMarkdownEditor,
}));

const DOC_CONTENT_FALLBACK_CLASS_NAME =
  "flex min-h-[240px] items-center justify-center text-sm text-slate-500";

interface KBDocViewerProps {
  sourceId: string;
  showFindBar?: boolean;
  onCloseFindBar?: () => void;
}

interface KBDocViewerContentProps {
  paneId: string;
  activeDocId: string;
  showFindBar?: boolean;
  onCloseFindBar?: () => void;
}

function KBDocViewerContent({
  paneId,
  activeDocId,
  showFindBar,
  onCloseFindBar,
}: KBDocViewerContentProps) {
  // Pane-scoped navigation
  const navigateToDocInPane = useKBStore((s) => s.navigateToDocInPane);

  // Shared state
  const activeTag = useKBStore((s) => s.activeTag);
  const treeData = useKBStore((s) => s.treeData);
  const setActiveTag = useKBStore((s) => s.setActiveTag);
  const fetchDoc = useKBStore((s) => s.fetchDoc);
  const editModes = useKBStore((s) => s.editModes);
  const renameDoc = useKBStore((s) => s.renameDoc);
  const updateTabTitle = useKBStore((s) => s.updateTabTitle);
  const setEditBuffer = useKBStore((s) => s.setEditBuffer);
  const saveDoc = useKBStore((s) => s.saveDoc);
  const currentDoc = useKBStore((s) => s.docCache[activeDocId] ?? null);

  const [isDocLoading, setIsDocLoading] = useState(() => currentDoc === null);
  const printRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Build stem-based doc lookup for wikilink resolution
  const docLookup = useMemo(
    () => (treeData ? buildDocLookup(treeData) : new Map()),
    [treeData]
  );

  const isEditing = currentDoc ? (editModes[currentDoc.id] ?? false) : false;

  // Load document when activeDocId changes
  useEffect(() => {
    if (currentDoc) {
      updateTabTitle(currentDoc.id, currentDoc.title, currentDoc.source_id);
      return;
    }

    let cancelled = false;

    fetchDoc(activeDocId).then((doc) => {
      if (cancelled) {
        return;
      }
      setIsDocLoading(false);
      if (doc) {
        updateTabTitle(doc.id, doc.title, doc.source_id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeDocId, currentDoc, fetchDoc, updateTabTitle]);

  // Resolve wikilink target to href for the remark plugin
  const resolveLink = useCallback(
    (target: string): string | null => {
      const docId = resolveWikilink(
        target,
        docLookup,
        currentDoc?.relative_path
      );
      // Return the standard fragment href if resolved, null for broken
      return docId ? `#wikilink:${target}` : null;
    },
    [currentDoc?.relative_path, docLookup]
  );

  // Navigate to a wikilink target document -- scoped to this pane
  const handleWikilinkClick = useCallback(
    (target: string) => {
      const docId = resolveWikilink(
        target,
        docLookup,
        currentDoc?.relative_path
      );
      if (docId) {
        navigateToDocInPane(paneId, docId, target);
      }
    },
    [currentDoc?.relative_path, docLookup, navigateToDocInPane, paneId]
  );

  const handleTagClick = useCallback(
    (tag: string) => setActiveTag(tag),
    [setActiveTag]
  );
  const handleBacklinkNavigate = useCallback(
    (docId: string, title: string) =>
      navigateToDocInPane(paneId, docId, title),
    [navigateToDocInPane, paneId]
  );

  // Strip YAML frontmatter block to get body-only content
  const bodyWithoutFrontmatter = useMemo(() => {
    if (!currentDoc?.body) return "";
    const raw = currentDoc.body;
    const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? raw.slice(match[0].length) : raw;
  }, [currentDoc?.body]);

  // Add tag via the above-title button
  const handleAddTagAboveTitle = useCallback(
    async (tag: string) => {
      if (!currentDoc) return;
      const existingTags = normalizeTags(currentDoc.frontmatter?.tags);
      if (existingTags.includes(tag)) return;
      const newTags = [...existingTags, tag];
      const fm = { ...(currentDoc.frontmatter ?? {}), tags: newTags };
      const yamlStr = yaml.dump(fm, { lineWidth: -1 });
      const fullMarkdown = `---\n${yamlStr}---\n${bodyWithoutFrontmatter}`;
      setEditBuffer(currentDoc.id, fullMarkdown);
      await saveDoc(currentDoc.id);
    },
    [bodyWithoutFrontmatter, currentDoc, saveDoc, setEditBuffer]
  );

  return (
    <div
      ref={contentRef}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      <TagFilter activeTag={activeTag} onClearTag={() => setActiveTag(null)} />
      <KBNavBar doc={currentDoc} printRef={printRef} />

      {/* Add tag button (above title, non-read-only only) */}
      {currentDoc && !isDocLoading && !currentDoc.source?.read_only && (
        <AddTagButton
          existingTags={normalizeTags(currentDoc.frontmatter?.tags)}
          onAdd={handleAddTagAboveTitle}
        />
      )}

      {/* Inline editable title */}
      {currentDoc && !isDocLoading && (
        <InlineTitle
          docId={currentDoc.id}
          title={currentDoc.title}
          isEditing={isEditing}
          isReadOnly={currentDoc.source?.read_only ?? true}
          onRename={(newTitle) => renameDoc(currentDoc.id, newTitle)}
        />
      )}

      {/* Tag chips under title (TAG-01, TAG-02) */}
      {currentDoc &&
        !isDocLoading &&
        (() => {
          const tags = normalizeTags(currentDoc.frontmatter?.tags);
          return tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 -mt-1">
              {tags.map((tag) => (
                <TagPill key={tag} tag={tag} onClick={handleTagClick} />
              ))}
            </div>
          ) : null;
        })()}

      {/* Find bar (reading mode only, below title like Obsidian) */}
      {showFindBar && onCloseFindBar && (
        <KBFindBar containerRef={contentRef} onClose={onCloseFindBar} />
      )}

      {isDocLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      ) : currentDoc ? (
        <>
          {isEditing ? (
            <LazyBoundary
              fallbackLabel="Loading editor"
              fallbackClassName={DOC_CONTENT_FALLBACK_CLASS_NAME}
            >
              <MarkdownEditorContent
                docId={currentDoc.id}
                initialContent={currentDoc.body ?? ""}
              />
            </LazyBoundary>
          ) : (
            <>
              <div ref={printRef}>
                <h1 className="print-doc-title hidden">{currentDoc.title}</h1>
                <LazyBoundary
                  fallbackLabel="Loading document"
                  fallbackClassName={DOC_CONTENT_FALLBACK_CLASS_NAME}
                >
                  <MarkdownViewerContent
                    doc={currentDoc}
                    onTagClick={handleTagClick}
                    onWikilinkClick={handleWikilinkClick}
                    resolveLink={resolveLink}
                  />
                </LazyBoundary>
              </div>
              <BacklinkPanel
                backlinks={currentDoc.backlinks}
                onNavigate={(docId) => {
                  const bl = currentDoc.backlinks.find((b) => b.id === docId);
                  handleBacklinkNavigate(docId, bl?.title ?? "Document");
                }}
              />
              <UsedInPanel docId={currentDoc.id} />
            </>
          )}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
          <FileText className="h-10 w-10 opacity-40" />
          <p className="text-sm">Document not found</p>
        </div>
      )}
    </div>
  );
}

export function KBDocViewer({
  showFindBar,
  onCloseFindBar,
}: KBDocViewerProps) {
  const paneId = usePaneId();

  // Pane-scoped state
  const activeDocId = useKBStore((s) => s.panes[paneId]?.activeDocId ?? null);
  const openTabs = useKBStore((s) => s.panes[paneId]?.openTabs ?? []);
  const activeTabId = useKBStore((s) => s.panes[paneId]?.activeTabId ?? null);

  const activeTab = openTabs.find((t) => t.id === activeTabId);
  if (activeTab?.type === "new") {
    return <KBNewTabPage tabId={activeTab.id} />;
  }

  // Empty state when no document is selected
  if (!activeDocId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
        <FileText className="h-10 w-10 opacity-40" />
        <p className="text-sm">Select a document from the tree to view it</p>
      </div>
    );
  }

  return (
    <KBDocViewerContent
      key={activeDocId}
      paneId={paneId}
      activeDocId={activeDocId}
      showFindBar={showFindBar}
      onCloseFindBar={onCloseFindBar}
    />
  );
}
