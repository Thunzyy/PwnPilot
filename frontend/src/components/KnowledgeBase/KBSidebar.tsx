/**
 * KBSidebar -- Obsidian-like sidebar listing all KB sources grouped by type.
 * Shows VAULTS (local) and COMMUNITY sections, each expandable to reveal its
 * folder tree via KBTreeView. Includes global search and collapse support.
 */
import { useCallback, useEffect, useMemo } from "react";
import {
  ChevronRight, Database, FolderGit2, Loader2,
  PanelLeftClose, Settings,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as Collapsible from "@radix-ui/react-collapsible";
import { toast } from "sonner";

import { useKBStore } from "@/stores/kbStore";
import { kbApi } from "@/api/kb";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { showApiErrorToast } from "@/lib/apiToast";
import { cn } from "@/lib/utils";
import { BookmarkSection } from "./KBBrowser/BookmarkSection";
import { TagsSection } from "./KBBrowser/TagsSection";
import { KBTreeView } from "./KBBrowser/KBTreeView";
import { KBSearchBar } from "./KBBrowser/KBSearchBar";
import { KBSearchOverlay } from "./KBBrowser/KBSearchOverlay";
import { KBSearchOptionsPanel } from "./KBBrowser/KBSearchOptionsPanel";
import { KBSearchHistoryPanel } from "./KBBrowser/KBSearchHistoryPanel";
import { SidebarToolbar } from "./KBBrowser/SidebarToolbar";
import { TagFilter } from "./KBBrowser/TagFilter";
import type { KBTreeNode } from "@/types/kb";

/** Recursively search a tree for a document title by ID. */
function findDocTitle(tree: KBTreeNode | null, docId: string): string {
  if (!tree) return docId;
  for (const doc of tree.docs) {
    if (doc.id === docId) return doc.title;
  }
  for (const child of tree.children) {
    const found = findDocTitle(child, docId);
    if (found !== docId) return found;
  }
  return docId;
}

/* SourceTreeRoot -- single expandable source in the sidebar */
function SourceTreeRoot({
  name,
  icon,
  isExpanded,
  isLoading,
  tree,
  isReadOnly,
  highlightDocId,
  onToggle,
  onSelectDoc,
  onCopyPath,
  onCollapseAll,
  onRename,
  onDelete,
}: {
  sourceId: string;
  name: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  isLoading: boolean;
  tree: KBTreeNode | null;
  isReadOnly: boolean;
  highlightDocId: string | null;
  onToggle: () => void;
  onSelectDoc: (docId: string, openInNewTab?: boolean) => void;
  onCopyPath: (path: string) => void;
  onCollapseAll: (folderPath: string) => void;
  onRename?: (docId: string, currentTitle: string) => void;
  onDelete?: (docId: string, currentTitle: string) => void;
}) {
  const expandedFolders = useKBStore((s) => s.expandedFolders);
  const toggleFolder = useKBStore((s) => s.toggleFolder);
  const activeDocId = useKBStore((s) => s.activeDocId);

  return (
    <Collapsible.Root open={isExpanded} onOpenChange={onToggle}>
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm",
          "text-slate-300 hover:bg-white/[0.05] hover:text-slate-100",
          "cursor-pointer select-none",
        )}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
        />
        {icon}
        <span className="truncate flex-1 text-left">{name}</span>
        {isLoading && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-slate-500" />
        )}
      </Collapsible.Trigger>
      <Collapsible.Content className="pl-2">
        <KBTreeView
          tree={tree}
          activeDocId={activeDocId}
          expandedFolders={expandedFolders}
          isLoading={isLoading || !tree}
          onToggleFolder={toggleFolder}
          onSelectDoc={onSelectDoc}
          onCopyPath={onCopyPath}
          onCollapseAll={onCollapseAll}
          onRename={onRename}
          onDelete={onDelete}
          isReadOnly={isReadOnly}
          highlightDocId={highlightDocId}
        />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/* ------------------------------------------------------------------ */

interface KBSidebarProps {
  onSelectDoc: (docId: string, sourceId: string, title: string, openInNewTab?: boolean) => void;
  onCollapse?: () => void;
  onRename?: (docId: string, currentTitle: string) => void;
  onDelete?: (docId: string, currentTitle: string) => void;
}

export function KBSidebar({ onSelectDoc, onCollapse, onRename, onDelete }: KBSidebarProps) {
  const navigate = useNavigate();
  const sources = useKBStore((s) => s.sources);
  const searchQuery = useKBStore((s) => s.searchQuery);
  const expandedSources = useKBStore((s) => s.expandedSources);
  const toggleSourceExpanded = useKBStore((s) => s.toggleSourceExpanded);
  const treesPerSource = useKBStore((s) => s.treesPerSource);
  const treeLoadingSet = useKBStore((s) => s.treeLoadingSet);
  const highlightDocId = useKBStore((s) => s.highlightDocId);
  const fetchBookmarks = useKBStore((s) => s.fetchBookmarks);
  const bookmarksLoaded = useKBStore((s) => s.bookmarksLoaded);
  const isSearchInputFocused = useKBStore((s) => s.isSearchInputFocused);
  const showSearchOptions = useKBStore((s) => s.showSearchOptions);
  const recentSearches = useKBStore((s) => s.recentSearches);
  const removeRecentSearch = useKBStore((s) => s.removeRecentSearch);
  const clearRecentSearches = useKBStore((s) => s.clearRecentSearches);
  const searchDocs = useKBStore((s) => s.searchDocs);
  const setPendingPrefix = useKBStore((s) => s.setPendingPrefix);
  const activeTag = useKBStore((s) => s.activeTag);
  const setActiveTag = useKBStore((s) => s.setActiveTag);
  const fetchTreeForSource = useKBStore((s) => s.fetchTreeForSource);
  const fetchTree = useKBStore((s) => s.fetchTree);
  const treeData = useKBStore((s) => s.treeData);
  const isTreeLoading = useKBStore((s) => s.isTreeLoading);
  const hydrateExpandedTrees = useKBStore((s) => s.hydrateExpandedTrees);
  const activeDocId = useKBStore((s) => s.activeDocId);
  const expandedFolders = useKBStore((s) => s.expandedFolders);
  const toggleFolder = useKBStore((s) => s.toggleFolder);
  const treeSortOrder = useKBStore((s) => s.treeSortOrder);
  const cycleTreeSortOrder = useKBStore((s) => s.cycleTreeSortOrder);
  const collapseAllFolders = useKBStore((s) => s.collapseAllFolders);
  const revealInNavigation = useKBStore((s) => s.revealInNavigation);
  const createUntitledNote = useKBStore((s) => s.createUntitledNote);

  useEffect(() => {
    if (!bookmarksLoaded) fetchBookmarks();
  }, [bookmarksLoaded, fetchBookmarks]);

  /* Fetch tree data for sources that were persisted as expanded but whose
     tree hasn't been loaded yet (e.g. after a page reload). */
  useEffect(() => {
    if (sources.length > 0) hydrateExpandedTrees();
  }, [sources, hydrateExpandedTrees]);

  // Re-fetch trees when tag filter changes (NOT on source expand/collapse)
  useEffect(() => {
    if (activeTag) {
      fetchTree();
    } else {
      // Tag cleared → re-fetch per-source trees for currently expanded sources
      const current = useKBStore.getState().expandedSources;
      for (const sourceId of current) {
        fetchTreeForSource(sourceId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTag]);

  const isSearchMode = searchQuery.trim().length > 0;
  const showOptionsPanel = isSearchInputFocused && !isSearchMode && showSearchOptions;

  const localSources = useMemo(
    () => sources.filter((s) => s.source_type === "local"),
    [sources],
  );

  const communityGroups = useMemo(() => {
    const groups = new Map<string, typeof sources>();
    for (const s of sources) {
      if (s.source_type !== "community" || !s.remote_url) continue;
      const list = groups.get(s.remote_url);
      if (list) list.push(s);
      else groups.set(s.remote_url, [s]);
    }
    return groups;
  }, [sources]);

  /** Create a doc-select handler scoped to a source. */
  function handleDocSelect(sourceId: string) {
    return (docId: string, openInNewTab?: boolean) => {
      const tree = treesPerSource[sourceId] ?? null;
      onSelectDoc(docId, sourceId, findDocTitle(tree, docId), openInNewTab);
    };
  }

  /** Copy a path to clipboard with toast feedback. */
  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      toast.success("Path copied to clipboard");
    });
  }, []);

  /** Collapse all subfolders under a given path. */
  const handleCollapseAll = useCallback((folderPath: string) => {
    useKBStore.setState((state) => ({
      expandedFolders: state.expandedFolders.filter(
        (f) => !f.startsWith(folderPath),
      ),
    }));
  }, []);

  /** Insert a filter prefix into the search input. */
  const handleSelectPrefix = useCallback((prefix: string) => {
    setPendingPrefix(prefix);
  }, [setPendingPrefix]);

  /** Rerun a recent search: push query into input and trigger API call. */
  const handleSelectRecent = useCallback((query: string) => {
    setPendingPrefix(query);
    searchDocs(query);
  }, [setPendingPrefix, searchDocs]);

  const handleNewNote = useCallback(() => {
    createUntitledNote();
  }, [createUntitledNote]);

  const handleNewFolder = useCallback(async () => {
    const writable = sources.filter((s) => !s.read_only);
    if (writable.length === 0) {
      toast.error("No writable source. Add a local vault first.");
      return;
    }
    const folderName = prompt("Folder name:");
    if (!folderName?.trim()) return;
    try {
      await kbApi.createFolder(writable[0].id, folderName.trim());
      toast.success("Folder created. It will appear when you add a note to it.");
      fetchTreeForSource(writable[0].id);
    } catch (error) {
      showApiErrorToast(
        "Failed to create folder",
        error,
        "Could not create this folder.",
      );
    }
  }, [sources, fetchTreeForSource]);

  const handleRevealCurrentFile = useCallback(() => {
    if (activeDocId) {
      revealInNavigation(activeDocId);
    }
  }, [activeDocId, revealInNavigation]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0b0f17]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Knowledge Base
        </span>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-slate-500 hover:text-slate-300"
          onClick={() => onCollapse?.()}
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Search (all sources) */}
      <KBSearchBar sourceId="" onSelectResult={onSelectDoc} />

      {/* Toolbar (hidden during search mode) */}
      {!isSearchMode && (
        <SidebarToolbar
          onNewNote={handleNewNote}
          onNewFolder={handleNewFolder}
          sortOrder={treeSortOrder}
          onCycleSortOrder={cycleTreeSortOrder}
          onRevealCurrentFile={handleRevealCurrentFile}
          onCollapseAll={collapseAllFolders}
        />
      )}

      {/* Active tag filter indicator (TAG-05) */}
      {!isSearchMode && activeTag && (
        <div className="px-2 pb-1">
          <TagFilter activeTag={activeTag} onClearTag={() => setActiveTag(null)} />
        </div>
      )}

      {/* Conditional: search overlay / options+history / source trees */}
      {isSearchMode ? (
        <KBSearchOverlay onSelectResult={onSelectDoc} />
      ) : showOptionsPanel ? (
        <ScrollArea className="flex-1">
          <KBSearchOptionsPanel onSelectPrefix={handleSelectPrefix} />
          <KBSearchHistoryPanel
            recentSearches={recentSearches}
            onSelectRecent={handleSelectRecent}
            onRemoveRecent={removeRecentSearch}
            onClearAll={clearRecentSearches}
          />
        </ScrollArea>
      ) : (
        <ScrollArea className="flex-1">
          {sources.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p className="text-sm text-slate-500">No sources configured</p>
              <Button
                variant="ghost" size="sm"
                className="text-primary/70 hover:text-primary"
                onClick={() => navigate("/notes/settings")}
              >
                Add sources
              </Button>
            </div>
          ) : (
            <div className="py-1">
              {/* BOOKMARKS */}
              <BookmarkSection onSelectDoc={onSelectDoc} />
              {/* TAGS (TAG-08) */}
              <TagsSection activeTag={activeTag} onTagClick={setActiveTag} />
              {activeTag ? (
                /* Global tree when tag filter is active */
                <div className="mb-1 px-1">
                  <KBTreeView
                    tree={treeData}
                    activeDocId={activeDocId}
                    expandedFolders={expandedFolders}
                    isLoading={isTreeLoading}
                    onToggleFolder={toggleFolder}
                    onSelectDoc={(docId, openInNewTab) => {
                      const title = treeData ? findDocTitle(treeData, docId) : docId;
                      onSelectDoc(docId, "", title, openInNewTab);
                    }}
                    onCopyPath={handleCopyPath}
                    onCollapseAll={handleCollapseAll}
                    isReadOnly={true}
                    highlightDocId={highlightDocId}
                  />
                </div>
              ) : (
                <>
                  {/* VAULTS */}
                  {localSources.length > 0 && (
                    <div className="mb-1">
                      <h3 className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                        Vaults
                      </h3>
                      {localSources.map((src) => (
                        <SourceTreeRoot
                          key={src.id} sourceId={src.id} name={src.name}
                          icon={<Database className="h-3.5 w-3.5 shrink-0 text-primary/70" />}
                          isExpanded={expandedSources.includes(src.id)}
                          isLoading={treeLoadingSet.includes(src.id)}
                          tree={treesPerSource[src.id] ?? null}
                          isReadOnly={src.read_only}
                          highlightDocId={highlightDocId}
                          onToggle={() => toggleSourceExpanded(src.id)}
                          onSelectDoc={handleDocSelect(src.id)}
                          onCopyPath={handleCopyPath}
                          onCollapseAll={handleCollapseAll}
                          onRename={src.read_only ? undefined : onRename}
                          onDelete={src.read_only ? undefined : onDelete}
                        />
                      ))}
                    </div>
                  )}
                  {/* COMMUNITY */}
                  {communityGroups.size > 0 && (
                    <div className="mb-1">
                      <h3 className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                        Community
                      </h3>
                      {[...communityGroups.values()].map((group) => {
                        const rep = group[0];
                        return (
                          <SourceTreeRoot
                            key={rep.id} sourceId={rep.id} name={rep.name}
                            icon={<FolderGit2 className="h-3.5 w-3.5 shrink-0 text-primary/70" />}
                            isExpanded={expandedSources.includes(rep.id)}
                            isLoading={treeLoadingSet.includes(rep.id)}
                            tree={treesPerSource[rep.id] ?? null}
                            isReadOnly={rep.read_only}
                            highlightDocId={highlightDocId}
                            onToggle={() => toggleSourceExpanded(rep.id)}
                            onSelectDoc={handleDocSelect(rep.id)}
                            onCopyPath={handleCopyPath}
                            onCollapseAll={handleCollapseAll}
                            onRename={rep.read_only ? undefined : onRename}
                            onDelete={rep.read_only ? undefined : onDelete}
                          />
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </ScrollArea>
      )}

      {/* Footer */}
      <div className="border-t border-white/5 px-3 py-2">
        <Button
          variant="ghost" size="sm"
          className="w-full justify-start gap-2 text-slate-500 hover:text-slate-300"
          onClick={() => navigate("/notes/settings")}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </Button>
      </div>
    </div>
  );
}
