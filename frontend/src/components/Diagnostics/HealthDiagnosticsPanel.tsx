import {
  Activity,
  AlertTriangle,
  Bot,
  Network,
  Shield,
  Terminal,
  Trash2,
  WifiOff,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getDiagnosticsCategoryLabel } from "@/lib/diagnostics";
import type { DiagnosticsCategory, DiagnosticsEvent } from "@/stores/diagnosticsStore";
import { useDiagnosticsStore } from "@/stores/diagnosticsStore";

interface HealthDiagnosticsPanelProps {
  className?: string;
  showLabel?: boolean;
}

const CATEGORY_ORDER: DiagnosticsCategory[] = [
  "api",
  "websocket",
  "ai",
  "vpn",
  "terminal",
];

const CATEGORY_ICONS: Record<
  DiagnosticsCategory,
  typeof Activity
> = {
  api: Network,
  websocket: WifiOff,
  ai: Bot,
  vpn: Shield,
  terminal: Terminal,
};

const severityClass = (severity: DiagnosticsEvent["severity"]) => {
  if (severity === "error") {
    return "border-red-400/30 bg-red-500/10 text-red-300";
  }
  if (severity === "warning") {
    return "border-amber-400/30 bg-amber-500/10 text-amber-200";
  }
  return "border-cyan-400/30 bg-cyan-500/10 text-cyan-200";
};

const formatEventTime = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function CategoryCard({
  category,
  events,
}: {
  category: DiagnosticsCategory;
  events: DiagnosticsEvent[];
}) {
  const Icon = CATEGORY_ICONS[category];
  const count = events.filter((event) => event.category === category).length;
  const lastEvent = events.find((event) => event.category === category);

  return (
    <div className="rounded-lg border border-border-dark bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <Icon className="size-3.5" />
          </div>
          <div>
            <div className="text-xs font-bold text-text-primary">
              {getDiagnosticsCategoryLabel(category)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">
              {count === 0 ? "clean" : `${count} event${count > 1 ? "s" : ""}`}
            </div>
          </div>
        </div>
        <span
          className={`size-2 rounded-full ${
            count > 0 ? "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.8)]" : "bg-emerald-400"
          }`}
        />
      </div>
      <div className="mt-3 line-clamp-2 min-h-8 text-[11px] text-text-secondary">
        {lastEvent
          ? `${lastEvent.severity.toUpperCase()} captured ${formatEventTime(
              lastEvent.timestamp
            )}`
          : "No recent issue."}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: DiagnosticsEvent }) {
  return (
    <div className="rounded-lg border border-border-dark bg-bg-tertiary/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-text-primary">
              {event.title}
            </span>
            <Badge
              variant="outline"
              className={`h-5 border px-1.5 text-[10px] uppercase ${severityClass(
                event.severity
              )}`}
            >
              {event.severity}
            </Badge>
            {event.count > 1 ? (
              <Badge className="h-5 px-1.5 text-[10px]">x{event.count}</Badge>
            ) : null}
          </div>
          <p className="mt-1 break-words text-xs text-text-secondary">
            {event.message}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-text-muted">
            <span>{getDiagnosticsCategoryLabel(event.category).toLowerCase()}</span>
            {event.method ? <span>{event.method}</span> : null}
            {event.status ? <span>HTTP {event.status}</span> : null}
            {event.code ? <span>{event.code}</span> : null}
            {event.source ? <span className="break-all">{event.source}</span> : null}
          </div>
        </div>
        <time className="shrink-0 text-[10px] font-mono text-text-muted">
          {formatEventTime(event.timestamp)}
        </time>
      </div>
    </div>
  );
}

export function HealthDiagnosticsPanel({
  className,
  showLabel = true,
}: HealthDiagnosticsPanelProps) {
  const events = useDiagnosticsStore((state) => state.events);
  const clearEvents = useDiagnosticsStore((state) => state.clearEvents);
  const issueCount = events.filter((event) => event.severity !== "info").length;
  const hasEvents = events.length > 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={showLabel ? "sm" : "icon"}
          aria-label="Health diagnostics"
          className={`relative h-9 border border-border-dark bg-white/[0.03] text-text-secondary hover:bg-white/[0.06] hover:text-white ${
            className ?? ""
          }`}
        >
          <Activity
            className={`size-4 ${issueCount > 0 ? "text-amber-300" : "text-emerald-400"}`}
          />
          {showLabel ? <span className="ml-2 text-xs font-semibold">Health</span> : null}
          {issueCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-black text-slate-950 shadow-[0_0_8px_rgba(252,211,77,0.8)]">
              {issueCount > 99 ? "99+" : issueCount}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[86vh] max-w-5xl border-border-dark bg-[#0f1522] p-0 text-text-primary shadow-2xl">
        <DialogHeader className="border-b border-border-dark px-6 py-5">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div>
              <DialogTitle className="flex items-center gap-2 text-lg font-black">
                <Activity className="size-5 text-primary" />
                Health diagnostics
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm text-text-secondary">
                Recent API, WebSocket, AI, VPN and terminal failures captured by
                the running UI session.
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearEvents}
              disabled={!hasEvents}
              aria-label="Clear events"
              className="border-border-dark bg-bg-tertiary text-text-secondary hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
            >
              <Trash2 className="mr-2 size-3.5" />
              Clear
            </Button>
          </div>
        </DialogHeader>

        <div className="grid gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {CATEGORY_ORDER.map((category) => (
              <CategoryCard key={category} category={category} events={events} />
            ))}
          </div>

          <div className="min-w-0 rounded-xl border border-border-dark bg-background-dark/70">
            <div className="flex items-center justify-between border-b border-border-dark px-4 py-3">
              <div>
                <div className="text-sm font-bold text-text-primary">
                  Recent events
                </div>
                <div className="text-[11px] text-text-muted">
                  Newest first, deduplicated for repeated failures.
                </div>
              </div>
              {issueCount > 0 ? (
                <Badge className="bg-amber-400/15 text-amber-200">
                  <AlertTriangle className="mr-1 size-3" />
                  {issueCount}
                </Badge>
              ) : null}
            </div>
            <ScrollArea className="h-[48vh]">
              <div className="space-y-3 p-4">
                {hasEvents ? (
                  events.map((event) => <EventRow key={event.id} event={event} />)
                ) : (
                  <div className="flex h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border-dark text-center">
                    <Activity className="mb-3 size-8 text-emerald-400" />
                    <div className="text-sm font-bold text-text-primary">
                      No diagnostics recorded
                    </div>
                    <div className="mt-1 max-w-sm text-xs text-text-muted">
                      API, provider, VPN and terminal errors will appear here
                      when the app captures them.
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
