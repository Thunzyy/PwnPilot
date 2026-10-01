/**
 * LinkKnowledgeDialog -- Search and link a KB article to a timeline entry.
 *
 * Uses shadcn Dialog with debounced KB search. Fetches already-linked docs
 * to show checkmarks and handles duplicate link errors gracefully (LINK-01).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { kbApi } from "@/api/kb";
import { linkingApi } from "@/api/linking";
import { useDebounce } from "@/hooks/useDebounce";
import { showApiErrorToast } from "@/lib/apiToast";
import type { KBSearchResult } from "@/types/kb";
import type { LinkedDoc } from "@/types/linking";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface LinkKnowledgeDialogProps {
  entryId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked?: () => void;
}

export function LinkKnowledgeDialog({
  entryId, projectId, open, onOpenChange, onLinked,
}: LinkKnowledgeDialogProps) {
  void projectId;
  const [query, setQuery] = useState("");
  const [optimisticLinkedIds, setOptimisticLinkedIds] = useState<string[]>([]);
  const debouncedQuery = useDebounce(query, 300);

  const linkedDocsQuery = useQuery<LinkedDoc[]>({
    queryKey: ["timeline", "entry-docs", entryId],
    queryFn: () => linkingApi.getEntryDocs(entryId),
    enabled: open,
  });

  const searchQuery = useQuery({
    queryKey: ["kb", "search", debouncedQuery],
    queryFn: () => kbApi.search(debouncedQuery, undefined, 10),
    enabled: open && debouncedQuery.length >= 2,
  });

  const linkedIds = useMemo(
    () =>
      new Set([
        ...(linkedDocsQuery.data ?? []).map((doc) => doc.doc_id),
        ...optimisticLinkedIds,
      ]),
    [linkedDocsQuery.data, optimisticLinkedIds],
  );
  const results = searchQuery.data?.items ?? ([] as KBSearchResult[]);
  const isSearching = searchQuery.isPending || searchQuery.isFetching;

  const handleOpenStateChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery("");
      setOptimisticLinkedIds([]);
    }
    onOpenChange(nextOpen);
  };

  const handleLink = async (docId: string) => {
    if (linkedIds.has(docId)) { toast.info("Already linked"); return; }
    try {
      await linkingApi.createLink(entryId, docId);
      setOptimisticLinkedIds((prev) =>
        prev.includes(docId) ? prev : [...prev, docId],
      );
      toast.success("KB article linked");
      onLinked?.();
      handleOpenStateChange(false);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.info("Already linked");
        setOptimisticLinkedIds((prev) =>
          prev.includes(docId) ? prev : [...prev, docId],
        );
      }
      else {
        showApiErrorToast(
          "Failed to link article",
          err,
          "Could not link this KB article.",
        );
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenStateChange}>
      <DialogContent className="bg-[#1a2030] border-white/10 text-slate-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-200">
            <BookOpen className="h-4 w-4" /> Link Knowledge Base Article
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Search for a KB article to link to this timeline entry.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles..." autoFocus
            className="w-full rounded border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-primary/40 focus:outline-none" />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {isSearching && (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
          )}
          {!isSearching && results.length === 0 && debouncedQuery.length >= 2 && (
            <p className="py-4 text-center text-sm text-slate-500">No results found</p>
          )}
          {!isSearching && results.map((doc) => {
            const isLinked = linkedIds.has(doc.id);
            return (
              <button key={doc.id} type="button" onClick={() => handleLink(doc.id)}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-white/[0.05] cursor-pointer">
                {isLinked ? <Check className="h-4 w-4 shrink-0 text-emerald-400" /> : <BookOpen className="h-4 w-4 shrink-0 text-slate-500" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-200">{doc.title}</p>
                  <p className="truncate text-xs text-slate-500">{doc.relative_path}</p>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
