/**
 * KBSplitContainer -- Conditionally renders single pane or split layout.
 *
 * Uses nested react-resizable-panels Group/Panel for the split view.
 * `splitDirection === 'horizontal'` = vertical divider (panes side by side).
 * `splitDirection === 'vertical'` = horizontal divider (panes stacked).
 * This matches react-resizable-panels orientation semantics.
 */
import { Group, Panel, Separator } from "react-resizable-panels";

import { useKBStore } from "@/stores/kbStore";
import { PaneProvider } from "./PaneContext";
import { KBPane } from "./KBPane";
import { LinkedViewPane } from "./LinkedViewPane";

export function KBSplitContainer() {
  const panes = useKBStore((s) => s.panes);
  const splitDirection = useKBStore((s) => s.splitDirection);
  const paneIds = Object.keys(panes);

  // Single pane -- no split
  if (paneIds.length === 1) {
    return (
      <PaneProvider value={paneIds[0]}>
        <KBPane />
      </PaneProvider>
    );
  }

  // Two panes -- split layout
  const orientation = splitDirection === "vertical" ? "vertical" : "horizontal";

  const renderPane = (pid: string) => {
    const pane = panes[pid];
    return pane?.type === "linked" ? <LinkedViewPane /> : <KBPane />;
  };

  return (
    <Group orientation={orientation}>
      <Panel id="pane-a" minSize={200}>
        <PaneProvider value={paneIds[0]}>
          {renderPane(paneIds[0])}
        </PaneProvider>
      </Panel>
      <Separator
        className="group relative flex items-center justify-center bg-white/5
                   transition-colors duration-150
                   data-[separator]:hover:bg-primary/50
                   data-[separator]:active:bg-primary/70"
      >
        <div
          className="absolute z-10 flex items-center justify-center rounded-sm
                      opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100"
        >
          <div className="h-4 w-0.5 rounded-full bg-primary/70" />
        </div>
      </Separator>
      <Panel id="pane-b" minSize={200}>
        <PaneProvider value={paneIds[1]}>
          {renderPane(paneIds[1])}
        </PaneProvider>
      </Panel>
    </Group>
  );
}
