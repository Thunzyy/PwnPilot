/**
 * useUnsavedChangesGuard -- Prevents browser close/refresh when
 * any document has unsaved changes.
 *
 * Attaches a beforeunload event listener that triggers the browser's
 * native "Leave site?" confirmation dialog when dirty docs exist.
 * Modern browsers show a generic message regardless of the string set.
 */
import { useEffect } from "react";

import { useKBStore } from "@/stores/kbStore";

export function useUnsavedChangesGuard() {
  const editBuffers = useKBStore((s) => s.editBuffers);
  const docCache = useKBStore((s) => s.docCache);

  useEffect(() => {
    // Check if any document has unsaved changes
    const hasDirty = Object.entries(editBuffers).some(
      ([docId, buffer]) => {
        const cached = docCache[docId];
        return buffer !== (cached?.body ?? "");
      },
    );

    if (!hasDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editBuffers, docCache]);
}
