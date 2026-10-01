import {
  FileArchive,
  Flag,
  HardDrive,
  KeyRound,
  Search,
  Server,
  ShieldAlert,
  TerminalSquare,
  UserRound,
} from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";
import type {
  AttackGraphComparisonState,
  AttackGraphNode,
} from "./types";

type TypedAttackGraphFlowNode = Node<
  {
    node: AttackGraphNode;
    highlighted: boolean;
    isDropAnimating?: boolean;
    comparisonState?: AttackGraphComparisonState;
  },
  "typed"
>;

const comparisonMeta: Record<
  AttackGraphComparisonState,
  {
    label: string;
    className: string;
    ring: string;
  }
> = {
  added: {
    label: "Added",
    className: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100",
    ring: "ring-2 ring-emerald-300/55",
  },
  removed: {
    label: "Removed",
    className: "border-rose-400/40 bg-rose-500/15 text-rose-100",
    ring: "ring-2 ring-rose-300/55",
  },
};

const typeMeta: Record<
  AttackGraphNode["type"],
  {
    icon: typeof Server;
    border: string;
    badge: string;
  }
> = {
  host: {
    icon: Server,
    border: "border-sky-400/40 bg-sky-500/10",
    badge: "bg-sky-500/15 text-sky-200",
  },
  service: {
    icon: HardDrive,
    border: "border-primary/40 bg-primary/10",
    badge: "bg-primary/15 text-primary",
  },
  credential: {
    icon: KeyRound,
    border: "border-amber-400/40 bg-amber-500/10",
    badge: "bg-amber-500/15 text-amber-200",
  },
  session: {
    icon: TerminalSquare,
    border: "border-emerald-400/40 bg-emerald-500/10",
    badge: "bg-emerald-500/15 text-emerald-200",
  },
  finding: {
    icon: ShieldAlert,
    border: "border-rose-400/40 bg-rose-500/10",
    badge: "bg-rose-500/15 text-rose-200",
  },
  loot: {
    icon: Flag,
    border: "border-primary/40 bg-primary/10",
    badge: "bg-primary/15 text-primary",
  },
  user: {
    icon: UserRound,
    border: "border-cyan-400/40 bg-cyan-500/10",
    badge: "bg-cyan-500/15 text-cyan-200",
  },
  action: {
    icon: Search,
    border: "border-slate-500/40 bg-slate-500/10",
    badge: "bg-slate-500/15 text-slate-200",
  },
  artifact: {
    icon: FileArchive,
    border: "border-primary/40 bg-primary/10",
    badge: "bg-primary/15 text-primary",
  },
};

export function TypedGraphNode({
  data,
  selected,
  dragging,
}: NodeProps<TypedAttackGraphFlowNode>) {
  const {
    node,
    highlighted,
    isDropAnimating = false,
    comparisonState,
  } = data;
  const isDragging = dragging === true;
  const meta = typeMeta[node.type];
  const comparison = comparisonState ? comparisonMeta[comparisonState] : null;
  const Icon = meta.icon;
  const subtitle =
    typeof node.meta.ip === "string"
      ? node.meta.ip
      : typeof node.meta.command === "string"
        ? node.meta.command
        : typeof node.meta.title === "string"
          ? node.meta.title
          : node.tags[0] ?? "";

  return (
    <div
      data-graph-node-id={node.id}
      data-graph-node-selected={selected ? "true" : undefined}
      className={cn(
        "relative w-[280px] rounded-xl border px-3 py-2 shadow-lg backdrop-blur-sm transition-shadow duration-150",
        meta.border,
        selected && "ring-2 ring-cyan-300/70",
        comparison?.ring,
        highlighted && "shadow-[0_0_0_1px_rgba(14,165,233,0.4),0_0_30px_rgba(14,165,233,0.18)]",
        isDragging &&
          "z-20 shadow-[0_0_0_1px_rgba(125,211,252,0.45),0_0_32px_rgba(14,165,233,0.28)]"
      )}
    >
      {(isDragging || isDropAnimating) && (
        <>
          <div
            data-testid="attack-graph-drag-feedback"
            className={cn(
              "pointer-events-none absolute inset-[-6px] -z-10 rounded-[18px] border border-sky-300/25 bg-sky-400/5 opacity-100"
            )}
          />
          <div
            className={cn(
              "pointer-events-none absolute inset-x-8 -bottom-3 -z-10 h-3 rounded-full bg-sky-400/12 transition-opacity duration-150",
              isDragging || isDropAnimating ? "opacity-100" : "opacity-0"
            )}
          />
        </>
      )}
      <Handle type="target" position={Position.Left} className="!bg-slate-300/60" />
      <button
        type="button"
        aria-label={`graph node ${node.label}`}
        className="w-full text-left"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-white/10 bg-slate-950/60 p-2 text-slate-100">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-white">
                {node.label}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  meta.badge
                )}
              >
                {node.type}
              </span>
            </div>
            {comparison ? (
              <span
                className={cn(
                  "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                  comparison.className,
                )}
              >
                {comparison.label}
              </span>
            ) : null}
            {subtitle ? (
              <p className="mt-1 line-clamp-2 text-xs text-slate-300">{subtitle}</p>
            ) : null}
          </div>
        </div>
      </button>
      <Handle type="source" position={Position.Right} className="!bg-slate-300/60" />
    </div>
  );
}
