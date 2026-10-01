/**
 * ResizeHandle -- Styled Separator with hover affordance and double-click handler.
 * Renders between sidebar and content panels in KBResizableLayout.
 * Uses react-resizable-panels v4 Separator (NOT v3 PanelResizeHandle).
 */
import { Separator } from "react-resizable-panels";

interface ResizeHandleProps {
  onDoubleClick?: () => void;
}

export function ResizeHandle({ onDoubleClick }: ResizeHandleProps) {
  return (
    <Separator
      className="group relative flex w-px items-center justify-center bg-white/5
                 transition-colors duration-150
                 data-[separator]:hover:bg-primary/50
                 data-[separator]:active:bg-primary/70"
      onDoubleClick={onDoubleClick}
    >
      {/* Grip indicator visible on hover */}
      <div
        className="absolute z-10 flex h-8 w-3 items-center justify-center rounded-sm
                    opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100"
      >
        <div className="h-4 w-0.5 rounded-full bg-primary/70" />
      </div>
    </Separator>
  );
}
