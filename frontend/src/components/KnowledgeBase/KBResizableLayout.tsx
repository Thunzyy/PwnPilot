/**
 * KBResizableLayout -- Wraps the KB sidebar and content in a resizable
 * Group/Panel/Separator layout using react-resizable-panels v4.
 *
 * Features:
 * - Drag-to-resize sidebar with 100px minimum (SIDE-01)
 * - Layout persists to localStorage via useDefaultLayout (SIDE-02)
 * - Collapse/expand via imperative Panel API (SIDE-03)
 * - Double-click resize handle to reset to default 256px (SIDE-04)
 * - Visible hover affordance on resize handle (SIDE-05)
 */
import { useCallback, useEffect, useState } from "react";
import {
  Group,
  Panel,
  useDefaultLayout,
  usePanelRef,
} from "react-resizable-panels";
import type { PanelSize } from "react-resizable-panels";
import { PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ResizeHandle } from "./ResizeHandle";
import { KBSplitContainer } from "./KBSplitContainer";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const LAYOUT_STORAGE_ID = "pwnpilot:kb-layout";
const SIDEBAR_PANEL_ID = "kb-sidebar";
const CONTENT_PANEL_ID = "kb-content";
const DEFAULT_SIDEBAR_SIZE = 256; // pixels, matches current w-64
const MIN_SIDEBAR_SIZE = 100; // pixels (SIDE-01 lower bound)
// No max -- user can resize freely
const COLLAPSED_SIZE = 40; // pixels, matches current w-10 collapsed bar

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

interface KBResizableLayoutProps {
  sidebar: React.ReactNode;
  /** Ref that receives the collapse handler so parent can wire it to sidebar */
  onCollapseRef?: React.MutableRefObject<(() => void) | undefined>;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function KBResizableLayout({
  sidebar,
  onCollapseRef,
}: KBResizableLayoutProps) {
  const sidebarPanelRef = usePanelRef();

  // Persistence via useDefaultLayout hook (SIDE-02)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: LAYOUT_STORAGE_ID,
    storage: localStorage,
  });

  // Track collapsed state for conditional rendering
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Panel onResize fires with PanelSize
  const handleSidebarResize = useCallback(
    (size: PanelSize) => {
      setIsCollapsed(size.inPixels <= COLLAPSED_SIZE);
    },
    [],
  );

  // Double-click reset to default width (SIDE-04)
  const handleDoubleClickReset = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    panel.resize(DEFAULT_SIDEBAR_SIZE);
  }, [sidebarPanelRef]);

  // Collapse handler for sidebar button
  const handleCollapse = useCallback(() => {
    sidebarPanelRef.current?.collapse();
  }, [sidebarPanelRef]);

  // Expand handler for collapsed bar button
  const handleExpand = useCallback(() => {
    sidebarPanelRef.current?.expand();
  }, [sidebarPanelRef]);

  // Expose collapse handler to parent via ref
  useEffect(() => {
    if (onCollapseRef) {
      onCollapseRef.current = handleCollapse;
    }
  }, [onCollapseRef, handleCollapse]);

  return (
    <Group
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel
        id={SIDEBAR_PANEL_ID}
        panelRef={sidebarPanelRef}
        defaultSize={DEFAULT_SIDEBAR_SIZE}
        minSize={MIN_SIDEBAR_SIZE}

        collapsible
        collapsedSize={COLLAPSED_SIZE}
        onResize={handleSidebarResize}
      >
        {isCollapsed ? (
          <div className="flex h-full w-10 flex-col items-center border-r border-white/5 bg-[#0b0f17] py-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-500 hover:text-slate-300"
              onClick={handleExpand}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          sidebar
        )}
      </Panel>

      <ResizeHandle onDoubleClick={handleDoubleClickReset} />

      <Panel id={CONTENT_PANEL_ID} minSize={300}>
        <KBSplitContainer />
      </Panel>
    </Group>
  );
}
