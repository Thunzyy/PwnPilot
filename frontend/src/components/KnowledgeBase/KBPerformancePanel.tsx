import { Activity, BarChart3, Eraser, Timer } from "lucide-react";
import { useMemo } from "react";

import {
  summarizeKBPerfSamples,
  useKBPerfStore,
} from "@/lib/perf/kbPerf";
import { Button } from "@/components/ui/button";

const formatDuration = (value: number) => `${value} ms`;
const formatMaxDuration = (value: number) => `${value} ms max`;

export function KBPerformancePanel() {
  const samples = useKBPerfStore((state) => state.samples);
  const clearSamples = useKBPerfStore((state) => state.clearSamples);
  const summaries = useMemo(() => summarizeKBPerfSamples(samples), [samples]);

  return (
    <section
      data-testid="kb-performance-panel"
      className="rounded-xl border border-white/5 bg-black/20 p-5"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-slate-200">
            <div className="flex size-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
              <BarChart3 className="size-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                KB Performance Diagnostics
              </h3>
              <p className="text-xs text-slate-500">
                Session-local timings for KB search, tree, open, sources and
                sync flows.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
              <Activity className="size-3.5" />
              {samples.length} samples
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
              <Timer className="size-3.5" />
              {summaries.length} operations
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="self-start text-slate-400 hover:text-white"
          onClick={() => clearSamples()}
          disabled={samples.length === 0}
        >
          <Eraser className="mr-1.5 size-3.5" />
          Clear Samples
        </Button>
      </div>

      {summaries.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-white/10 bg-black/10 px-4 py-6 text-sm text-slate-500">
          No KB performance samples recorded yet.
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-white/5">
          <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,0.8fr))] gap-3 border-b border-white/5 bg-white/[0.03] px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            <span>Operation</span>
            <span>Samples</span>
            <span>Latest</span>
            <span>Average</span>
            <span>Max</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-white/5">
            {summaries.map((summary) => (
              <div
                key={summary.operation}
                className="grid grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,0.8fr))] gap-3 px-4 py-3 text-sm text-slate-300"
              >
                <span className="truncate font-mono text-[12px] text-slate-200">
                  {summary.operation}
                </span>
                <span>{summary.count}</span>
                <span>{formatDuration(summary.latestDurationMs)}</span>
                <span>{formatDuration(summary.averageDurationMs)}</span>
                <span>{formatMaxDuration(summary.maxDurationMs)}</span>
                <span
                  className={
                    summary.lastStatus === "error"
                      ? "text-red-300"
                      : "text-emerald-300"
                  }
                >
                  {summary.lastStatus}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
