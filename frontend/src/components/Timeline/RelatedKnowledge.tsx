/**
 * RelatedKnowledge -- Shows KB articles linked to a timeline entry
 * and provides a button to open the LinkKnowledgeDialog.
 *
 * Extracted from TimelineEntry to keep components under line limits.
 */
import { useEffect, useState } from "react";
import { BookOpen, Link } from "lucide-react";

import { linkingApi } from "@/api/linking";
import type { LinkedDoc } from "@/types/linking";
import { Button } from "@/components/ui/button";
import { LinkKnowledgeDialog } from "./LinkKnowledgeDialog";

interface RelatedKnowledgeProps {
  entryId: string;
  projectId: string;
}

export function RelatedKnowledge({ entryId, projectId }: RelatedKnowledgeProps) {
  const [linkedDocs, setLinkedDocs] = useState<LinkedDoc[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadDocs = () => {
    linkingApi.getEntryDocs(entryId).then(setLinkedDocs).catch(() => {});
  };

  useEffect(() => { loadDocs(); }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {linkedDocs.length > 0 && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <BookOpen className="h-3 w-3" />
            Related Knowledge
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {linkedDocs.map((doc) => (
              <span
                key={doc.doc_id}
                className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary"
                title={doc.relative_path}
              >
                {doc.title}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDialogOpen(true)}
          className="h-6 gap-1.5 px-2 text-[10px] font-bold text-slate-500 hover:text-primary"
        >
          <Link className="h-3 w-3" />
          Link Knowledge
        </Button>
      </div>

      <LinkKnowledgeDialog
        entryId={entryId}
        projectId={projectId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onLinked={loadDocs}
      />
    </>
  );
}
