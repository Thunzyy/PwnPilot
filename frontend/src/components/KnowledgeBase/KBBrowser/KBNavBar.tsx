/**
 * KBNavBar -- Composite navigation bar with back/forward buttons,
 * file path breadcrumb, and edit mode controls.
 *
 * Renders browser-style back/forward arrows on the left, breadcrumb
 * in the middle, and edit toggle + save button on the right.
 */
import type React from "react";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, ArrowRight, FileDown, Save } from "lucide-react";

import type { KBDocDetail } from "@/types/kb";
import { useKBStore } from "@/stores/kbStore";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { KBFileBreadcrumb } from "./KBFileBreadcrumb";
import { KBEditToggle } from "./KBEditToggle";

interface KBNavBarProps {
  doc: KBDocDetail | null;
  printRef?: React.RefObject<HTMLDivElement | null>;
}

export function KBNavBar({ doc, printRef }: KBNavBarProps) {
  const navStack = useKBStore((s) => s.navStack);
  const navCursor = useKBStore((s) => s.navCursor);
  const navigateBack = useKBStore((s) => s.navigateBack);
  const navigateForward = useKBStore((s) => s.navigateForward);
  const isEditing = useKBStore(
    (s) => (doc ? (s.editModes[doc.id] ?? false) : false),
  );
  const isDirty = useKBStore((s) => {
    if (!doc) return false;
    const buffer = s.editBuffers[doc.id];
    if (buffer === undefined) return false;
    const cached = s.docCache[doc.id];
    return buffer !== (cached?.body ?? "");
  });
  const saveDoc = useKBStore((s) => s.saveDoc);

  const handlePrint = useReactToPrint({
    contentRef: printRef ?? { current: null },
    documentTitle: doc?.title ?? "Document",
    pageStyle: `
      @page { margin: 20mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `,
  });

  const canGoBack = navCursor > 0;
  const canGoForward = navCursor < navStack.length - 1;
  const isReadOnly = doc?.source?.read_only ?? true;

  return (
    <div className="flex min-w-0 items-center gap-2 px-1 py-1">
      {/* Navigation arrows */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-default"
          onClick={navigateBack}
          disabled={!canGoBack}
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-default"
          onClick={navigateForward}
          disabled={!canGoForward}
          aria-label="Go forward"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Breadcrumb (fills available space) */}
      <div className="min-w-0 flex-1">
        {doc && <KBFileBreadcrumb doc={doc} />}
      </div>

      {/* Edit controls (right side) */}
      {doc && (
        <div className="flex items-center gap-0.5">
          {!isEditing && printRef && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-500 hover:text-slate-300"
                  onClick={() => handlePrint()}
                  aria-label="Export to PDF"
                >
                  <FileDown className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Export to PDF
              </TooltipContent>
            </Tooltip>
          )}
          <KBEditToggle docId={doc.id} isReadOnly={isReadOnly} />
          {isEditing && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-500 hover:text-slate-300 disabled:opacity-30"
                  onClick={() => saveDoc(doc.id)}
                  disabled={!isDirty}
                  aria-label="Save (Ctrl+S)"
                >
                  <Save className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Save (Ctrl+S)
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
