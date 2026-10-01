import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search,
  Terminal as TerminalIcon,
  CheckCircle2,
  AlertCircle,
  History,
  LayoutList,
  Loader2,
  FileText,
  Flag,
} from "lucide-react";
import { api } from "../../api/client";
import { aiApi } from "../../api/ai";
import { graphClient } from "@/features/attack-graph/api/graphClient";
import { TimelineEntry } from "./TimelineEntry";
import { CommandEntry } from "./CommandEntry";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  measureTimelinePerfAsync,
  recordTimelinePerfSample,
} from "@/lib/perf/timelinePerf";
import { useTerminalStore } from "@/stores/terminalStore";
import type { CommandHistory } from "@/types/ai";
import { TimelinePerformancePanel } from "./TimelinePerformancePanel";

interface TimelineEntryData {
  id: string;
  project_id: string;
  type: string;
  content: string;
  output: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const formatTimelineEntryForAI = (entry: TimelineEntryData) => {
  const lines = [
    `Timeline entry (${entry.type})`,
    `Content: ${entry.content}`,
  ];

  if (entry.output) {
    lines.push("Output:", "```", entry.output, "```");
  }

  return lines.join("\n");
};

// Unified entry type for mixed timeline + commands display
interface UnifiedEntry {
  id: string;
  entryType: "timeline" | "command";
  created_at: string;
  data: TimelineEntryData | CommandHistory;
}

interface TimelineViewProps {
  projectId: string;
  onSendToAI?: (text: string) => void;
  evidenceCommandIds?: string[];
  onRevealCommandEvidence?: (commandId: string) => void;
}

const getNow = () => globalThis.performance?.now?.() ?? Date.now();

const getCommandHistoryElementId = (commandId: string): string =>
  `history-command-${encodeURIComponent(commandId)}`;

export function TimelineView({
  projectId,
  onSendToAI,
  evidenceCommandIds = [],
  onRevealCommandEvidence,
}: TimelineViewProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntryData[]>([]);
  const [commands, setCommands] = useState<CommandHistory[]>([]);
  const [proposalRequests, setProposalRequests] = useState<Record<string, boolean>>(
    {}
  );
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const deferredSearch = useDeferredValue(search);
  const focusedCommandId = searchParams.get("commandId")?.trim() || null;
  const evidenceCommandIdSet = useMemo(
    () => new Set(evidenceCommandIds),
    [evidenceCommandIds]
  );
  const proposalsQuery = useQuery({
    queryKey: ["graph-proposals", projectId],
    queryFn: () => graphClient.listProjectProposals(projectId),
    enabled: Boolean(projectId),
  });
  const proposalStatusByCommand = useMemo(
    () =>
      (proposalsQuery.data?.items ?? []).reduce<Record<string, "pending" | "accepted">>(
        (acc, proposal) => {
          if (
            proposal.sourceType === "command_history" &&
            proposal.sourceId &&
            (proposal.status === "pending" || proposal.status === "accepted")
          ) {
            acc[proposal.sourceId] = proposal.status;
          }
          return acc;
        },
        {}
      ),
    [proposalsQuery.data]
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [timelineResponse, commandsResponse] = await measureTimelinePerfAsync(
        "timeline.load",
        () =>
          Promise.all([
            api.get<TimelineEntryData[]>(`/projects/${projectId}/timeline`),
            aiApi.listProjectCommands(projectId, {
              limit: 100,
              include_output: true,
            }),
          ]),
        {
          metadata: { projectId },
          onSuccess: ([timelineResult, commandsResult]) => ({
            timelineEntries: timelineResult.data.length,
            commandEntries: commandsResult.items.length,
            totalEntries:
              timelineResult.data.length + commandsResult.items.length,
          }),
        }
      );
      setTimelineEntries(timelineResponse.data);
      setCommands(commandsResponse.items);
    } catch {
      console.error("Failed to load timeline data");
      setTimelineEntries([]);
      setCommands([]);
      setErrorMessage("Failed to load timeline data. Check backend connection.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (focusedCommandId) {
      setSelectedFilter("command");
    }
  }, [focusedCommandId]);

  const handleDeleteCommand = async (commandId: string) => {
    try {
      await aiApi.deleteCommand(projectId, commandId);
      setCommands((prev) => prev.filter((c) => c.id !== commandId));
    } catch {
      console.error("Failed to delete command");
    }
  };

  const handleCopyCommand = (command: CommandHistory) => {
    navigator.clipboard.writeText(command.command);
  };

  const handleSendCommandToAI = (command: CommandHistory) => {
    if (onSendToAI) {
      const text = command.output
        ? `Command: \`${command.command}\`\nOutput:\n\`\`\`\n${command.output}\n\`\`\``
        : `Command: \`${command.command}\``;
      onSendToAI(text);
    }
  };

  const handleSendTimelineEntryToAI = (entry: TimelineEntryData) => {
    if (onSendToAI) {
      onSendToAI(formatTimelineEntryForAI(entry));
    }
  };

  const handleNavigateToTerminal = (sessionId: string) => {
    setActiveSession(sessionId);
    navigate(`/projects/${projectId}`);
  };

  const handleInferCommandToGraph = async (commandId: string) => {
    setProposalRequests((prev) => ({ ...prev, [commandId]: true }));
    try {
      const response = await graphClient.createHistoryProposal(projectId, commandId);
      const proposal = response.items.find(
        (item) => item.sourceType === "command_history" && item.sourceId === commandId
      );
      const proposalStatus =
        proposal?.status === "pending" || proposal?.status === "accepted"
          ? proposal.status
          : null;
      if (proposalStatus) {
        queryClient.setQueryData(
          ["graph-proposals", projectId],
          (current: Awaited<ReturnType<typeof graphClient.listProjectProposals>> | undefined) => {
            if (!current) {
              return response;
            }

            const nextItems = [...current.items];
            for (const item of response.items) {
              const existingIndex = nextItems.findIndex((existing) => existing.id === item.id);
              if (existingIndex >= 0) {
                nextItems[existingIndex] = item;
              } else {
                nextItems.unshift(item);
              }
            }

            return {
              items: nextItems,
              total: nextItems.length,
            };
          }
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["graph-proposals", projectId] });
    } catch {
      console.error("Failed to infer graph proposal from command history");
    } finally {
      setProposalRequests((prev) => {
        const next = { ...prev };
        delete next[commandId];
        return next;
      });
    }
  };

  const filters = [
    {
      id: null,
      label: "All Activity",
      icon: LayoutList,
      color: "text-primary",
    },
    {
      id: "command",
      label: "Commands",
      icon: TerminalIcon,
      color: "text-cyan-400",
    },
    {
      id: "note",
      label: "Notes",
      icon: FileText,
      color: "text-amber-400",
    },
    {
      id: "finding",
      label: "Findings",
      icon: AlertCircle,
      color: "text-red-400",
    },
    {
      id: "result",
      label: "Results",
      icon: CheckCircle2,
      color: "text-emerald-400",
    },
    {
      id: "flag",
      label: "Flags",
      icon: Flag,
      color: "text-primary",
    },
  ];

  const unifiedResult = useMemo(() => {
    const startedAt = getNow();
    const items: UnifiedEntry[] = [
      ...timelineEntries.map((entry) => ({
        id: entry.id,
        entryType: "timeline" as const,
        created_at: entry.created_at,
        data: entry,
      })),
      ...commands.map((command) => ({
        id: command.id,
        entryType: "command" as const,
        created_at: command.created_at,
        data: command,
      })),
    ].sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    );

    return {
      items,
      durationMs: getNow() - startedAt,
      metadata: {
        timelineEntries: timelineEntries.length,
        commandEntries: commands.length,
        totalEntries: items.length,
      },
    };
  }, [commands, timelineEntries]);

  const mergeDurationMs = unifiedResult.durationMs;
  const mergeCommandEntries = unifiedResult.metadata.commandEntries;
  const mergeTimelineEntries = unifiedResult.metadata.timelineEntries;
  const mergeTotalEntries = unifiedResult.metadata.totalEntries;

  useEffect(() => {
    if (isLoading || errorMessage || mergeTotalEntries === 0) {
      return;
    }

    recordTimelinePerfSample({
      operation: "timeline.merge",
      durationMs: mergeDurationMs,
      status: "success",
      metadata: {
        commandEntries: mergeCommandEntries,
        timelineEntries: mergeTimelineEntries,
        totalEntries: mergeTotalEntries,
      },
    });
  }, [
    errorMessage,
    isLoading,
    mergeCommandEntries,
    mergeDurationMs,
    mergeTimelineEntries,
    mergeTotalEntries,
  ]);

  const filteredResult = useMemo(() => {
    const startedAt = getNow();
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    const items = unifiedResult.items.filter((entry) => {
      if (selectedFilter === "command") {
        if (entry.entryType !== "command") return false;
      } else if (selectedFilter) {
        if (entry.entryType === "command") return false;
        if ((entry.data as TimelineEntryData).type !== selectedFilter) return false;
      }

      if (normalizedSearch) {
        if (entry.entryType === "command") {
          const command = entry.data as CommandHistory;
          return (
            command.command.toLowerCase().includes(normalizedSearch) ||
            command.output?.toLowerCase().includes(normalizedSearch) ||
            command.output_preview?.toLowerCase().includes(normalizedSearch)
          );
        }

        const timelineEntry = entry.data as TimelineEntryData;
        return (
          timelineEntry.content.toLowerCase().includes(normalizedSearch) ||
          timelineEntry.output?.toLowerCase().includes(normalizedSearch)
        );
      }

      return true;
    });

    return {
      items,
      durationMs: getNow() - startedAt,
      metadata: {
        totalEntries: unifiedResult.items.length,
        matchedEntries: items.length,
        searchLength: deferredSearch.trim().length,
        selectedFilter: selectedFilter ?? "all",
      },
    };
  }, [deferredSearch, selectedFilter, unifiedResult.items]);

  const filterDurationMs = filteredResult.durationMs;
  const filterMatchedEntries = filteredResult.metadata.matchedEntries;
  const filterSearchLength = filteredResult.metadata.searchLength;
  const filterSelectedValue = filteredResult.metadata.selectedFilter;
  const filterTotalEntries = filteredResult.metadata.totalEntries;

  useEffect(() => {
    if (isLoading || errorMessage || unifiedResult.items.length === 0) {
      return;
    }

    recordTimelinePerfSample({
      operation: "timeline.filter",
      durationMs: filterDurationMs,
      status: "success",
      metadata: {
        matchedEntries: filterMatchedEntries,
        searchLength: filterSearchLength,
        selectedFilter: filterSelectedValue,
        totalEntries: filterTotalEntries,
      },
    });
  }, [
    errorMessage,
    filterDurationMs,
    filterMatchedEntries,
    filterSearchLength,
    filterSelectedValue,
    filterTotalEntries,
    isLoading,
    unifiedResult.items.length,
  ]);

  const unifiedEntries = unifiedResult.items;
  const filteredUnifiedEntries = filteredResult.items;
  const hasAnyData = unifiedEntries.length > 0;
  const hasSearchOrFilter = Boolean(search.trim()) || selectedFilter !== null;
  const showPerformancePanel = hasAnyData && (unifiedEntries.length >= 10 || hasSearchOrFilter);

  useEffect(() => {
    if (!focusedCommandId || isLoading || errorMessage) return;
    const element = document.getElementById(
      getCommandHistoryElementId(focusedCommandId)
    );
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [errorMessage, filteredUnifiedEntries.length, focusedCommandId, isLoading]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm font-medium">
          Reconstructing Audit Trail...
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 w-full h-full bg-[#0b0f17] overflow-hidden">
      <header className="flex-none border-b border-white/5 bg-[#1a2030]/50 z-10">
        <div className="w-full px-6 py-4 space-y-4">
          <div className="flex items-center justify-between gap-6">
            <div className="flex-1 max-w-xl group relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500 group-focus-within:text-primary transition-colors" />
              <Input
                className="pl-10 h-10 bg-black/20 border-white/10 transition-colors focus:ring-primary/20"
                placeholder="Search audit logs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Auto-Scroll
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={cn(
                    "h-6 px-2 text-[10px] gap-1.5 font-bold transition-all border",
                    autoScroll
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-black/20 text-slate-500 border-white/5"
                  )}
                >
                  <History
                    className={cn("h-3 w-3", autoScroll && "animate-spin-slow")}
                    style={{ animationDuration: "3s" }}
                  />
                  {autoScroll ? "ACTIVE" : "PAUSED"}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {filters.map((filter) => {
              const FilterIcon = filter.icon;
              return (
                <Button
                  key={filter.id ?? "all"}
                  variant={selectedFilter === filter.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedFilter(filter.id)}
                  className={cn(
                    "h-7 px-3 text-xs font-semibold gap-2 transition-all",
                    selectedFilter === filter.id
                      ? "bg-primary text-white shadow-[0_0_15px_rgba(163,114,248,0.2)]"
                      : "border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 bg-transparent"
                  )}
                >
                  <FilterIcon
                    className={cn(
                      "h-3.5 w-3.5",
                      selectedFilter === filter.id ? "text-white" : filter.color
                    )}
                  />
                  {filter.label}
                </Button>
              );
            })}
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 w-full h-[calc(100%-140px)]">
        <div className="w-full px-6 py-10 relative">
          {/* Vertical Timeline Line */}
          <div className="absolute left-[33px] top-10 bottom-10 w-px bg-gradient-to-b from-primary/20 via-white/5 to-primary/20" />

          <div className="space-y-2">
            {errorMessage && (
              <div className="ml-8 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
                {errorMessage}
              </div>
            )}

            {!errorMessage &&
              filteredUnifiedEntries.map((entry) =>
                entry.entryType === "command" ? (() => {
                  const isEvidenceFocus = entry.id === focusedCommandId;
                  const canRevealEvidence =
                    Boolean(onRevealCommandEvidence) &&
                    evidenceCommandIdSet.has(entry.id);

                  return (
                    <div
                      key={entry.id}
                      id={getCommandHistoryElementId(entry.id)}
                      data-testid={`history-command-${entry.id}`}
                      data-evidence-focus={isEvidenceFocus ? "true" : undefined}
                      className={cn(
                        "rounded-xl transition-colors",
                        isEvidenceFocus &&
                          "border border-primary/40 bg-primary/[0.05] p-2 shadow-[0_0_24px_rgba(14,165,233,0.12)]"
                      )}
                    >
                      {isEvidenceFocus && (
                        <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-primary">
                          Evidence focus
                        </div>
                      )}
                      <CommandEntry
                        command={entry.data as CommandHistory}
                        onCopy={() => handleCopyCommand(entry.data as CommandHistory)}
                        onSendToAI={() => handleSendCommandToAI(entry.data as CommandHistory)}
                        onDelete={() => handleDeleteCommand(entry.id)}
                        onInferGraph={() => handleInferCommandToGraph(entry.id)}
                        graphProposalStatus={
                          proposalRequests[entry.id]
                            ? "creating"
                            : (proposalStatusByCommand[entry.id] ?? null)
                        }
                        canRevealEvidence={canRevealEvidence}
                        onRevealEvidence={
                          canRevealEvidence
                            ? () => onRevealCommandEvidence?.(entry.id)
                            : undefined
                        }
                        onNavigateToTerminal={() => handleNavigateToTerminal((entry.data as CommandHistory).session_id)}
                      />
                    </div>
                  );
                })() : (
                  <TimelineEntry
                    key={entry.id}
                    type={(entry.data as TimelineEntryData).type as "action" | "result" | "error" | "note"}
                    content={(entry.data as TimelineEntryData).content}
                    timestamp={new Date((entry.data as TimelineEntryData).created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                    author="user"
                    output={(entry.data as TimelineEntryData).output || undefined}
                    entryId={entry.id}
                    projectId={projectId}
                    onSendToAI={() => handleSendTimelineEntryToAI(entry.data as TimelineEntryData)}
                  />
                )
              )}

            {!errorMessage && !hasAnyData && (
              <div className="ml-8 rounded-md border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-400">
                No audit data yet. Run commands in the Terminal to start tracking.
              </div>
            )}

            {!errorMessage && hasAnyData && filteredUnifiedEntries.length === 0 && (
              <div className="ml-8 rounded-md border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-400">
                {hasSearchOrFilter
                  ? "No activity matches current search/filter."
                  : "No audit data yet. Run commands in the Terminal to start tracking."}
              </div>
            )}

            {!errorMessage && filteredUnifiedEntries.length > 0 && (
              <div className="flex items-center gap-6 pl-1 pt-4 opacity-50 relative">
                <div className="size-4 rounded-full bg-primary/20 animate-pulse border border-primary/30 flex items-center justify-center relative z-10">
                  <div className="size-1.5 rounded-full bg-primary" />
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">
                  End of available audit data
                </span>
              </div>
            )}

            {!errorMessage && showPerformancePanel && (
              <div className="ml-8 pt-6">
                <TimelinePerformancePanel />
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
