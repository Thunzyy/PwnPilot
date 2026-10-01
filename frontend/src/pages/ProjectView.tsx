import {
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type MouseEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Terminal as TerminalIcon,
  Code,
  Bot,
  FileText,
  History,
  BarChart3,
  Target,
  Maximize2,
  LayoutPanelLeft,
  Settings2,
  Loader2,
  Users,
  X,
  ChevronDown,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { fetchSettings, settingsQueryKeys } from "@/api/settings";
import {
  compareReportBundleArtifacts,
  createReportProposal,
  reportQueryKeys,
} from "@/api/report";
import {
  Sidebar,
  type SidebarEvidenceSelection,
} from "../components/Sidebar/Sidebar";
import { AttackGraph } from "../components/Graph/AttackGraph";
import type { ProjectVariables } from "../types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  fetchProjectVpnStatus,
  getProjectAccessErrorState,
  projectQueryKeys,
} from "@/api/projects";
import { useProjectStore } from "../stores/projectStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useAIComposerStore } from "@/stores/aiComposerStore";
import { useAuthStore } from "@/stores/authStore";
import { useProjectDetail } from "@/hooks/useProjectDetail";
import { useProjectEngagement } from "@/hooks/useProjectEngagement";
import { LazyBoundary } from "@/components/Layout/LazyBoundary";
import { ProjectAccessState } from "@/components/Projects/ProjectAccessState";
import { getUserFacingErrorMessage } from "@/lib/apiError";
import { showApiErrorToast } from "@/lib/apiToast";
import { getVpnPlatformList, resolveProjectVpnConnection } from "@/lib/vpn";
import type {
  EngagementChecklistSection,
  EngagementDemoProfileId,
  EngagementGraphNode,
} from "@/types/engagement";
import type {
  CreateReportProposalPayload,
  ReportBundleArtifactCompareResponse,
  ReportEvidenceUsageTarget,
} from "@/types/report";
import type { AttackGraphComparisonOverlay } from "@/features/attack-graph/types";

type ProjectStoreState = ReturnType<typeof useProjectStore.getState>;
type TerminalStoreState = ReturnType<typeof useTerminalStore.getState>;

const AdvancedTerminalPanel = lazy(async () => ({
  default: (await import("../components/Terminal/AdvancedTerminal"))
    .AdvancedTerminal,
}));
const CommandsLibraryPanel = lazy(async () => ({
  default: (await import("../components/Commands/CommandsLibrary"))
    .CommandsLibrary,
}));
const AIChatPanel = lazy(async () => ({
  default: (await import("../components/AI/AIChatLayout")).AIChatLayout,
}));
const TimelinePanel = lazy(async () => ({
  default: (await import("../components/Timeline/TimelineView")).TimelineView,
}));
const ProjectSetupDialog = lazy(async () => ({
  default: (await import("../components/Projects/ProjectSetupPanel"))
    .ProjectSetupPanel,
}));
const ProjectTeamSection = lazy(async () => ({
  default: (await import("../components/Projects/ProjectTeamPanel"))
    .ProjectTeamPanel,
}));
const ProjectContextPanel = lazy(async () => ({
  default: (await import("../components/Projects/ProjectContextPanel"))
    .ProjectContextPanel,
}));
const ProjectKnowledgeBase = lazy(async () => ({
  default: (await import("./KnowledgeBase")).KnowledgeBase,
}));
const ProjectReportsPage = lazy(async () => ({
  default: (await import("./Reports")).ReportsPage,
}));

const VALID_TABS = [
  "terminal",
  "commands",
  "context",
  "notes",
  "ai",
  "reports",
  "timeline",
  "team",
] as const;
type ValidTab = (typeof VALID_TABS)[number];
const PROJECT_TAB_DRAG_MIME = "application/x-pwnpilot-project-tab";

interface ProjectTabContextMenuState {
  tabValue: ValidTab;
  x: number;
  y: number;
}

const TAB_LABELS: Record<ValidTab, string> = {
  terminal: "Terminal",
  commands: "Commands",
  context: "Context",
  notes: "Notes",
  ai: "AI Assistant",
  reports: "Reports",
  timeline: "History",
  team: "Team",
};

const TAB_ICONS: Record<
  ValidTab,
  ComponentType<{ className?: string }>
> = {
  terminal: TerminalIcon,
  commands: Code,
  context: Target,
  notes: FileText,
  ai: Bot,
  reports: BarChart3,
  timeline: History,
  team: Users,
};

// Keep the default UI order stable (separate from VALID_TABS which is used as a canonical allowlist).
const DEFAULT_TAB_ORDER: ValidTab[] = [
  "terminal",
  "commands",
  "context",
  "ai",
  "notes",
  "reports",
  "timeline",
  "team",
];

const readStoredBool = (
  projectId: string | undefined,
  key: string,
  fallback: boolean
) => {
  if (!projectId || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(
      `pwnpilot:project:${projectId}:${key}`
    );
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
};

const readStoredTab = (
  projectId: string | undefined,
  key: string,
  fallback: ValidTab
): ValidTab => {
  if (!projectId || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`pwnpilot:project:${projectId}:${key}`);
    if (!raw) return fallback;
    return VALID_TABS.includes(raw as ValidTab) ? (raw as ValidTab) : fallback;
  } catch {
    return fallback;
  }
};

const normalizeTabOrder = (
  maybeOrder: unknown,
  fallback: readonly ValidTab[]
): ValidTab[] => {
  const seen = new Set<ValidTab>();
  const next: ValidTab[] = [];

  if (Array.isArray(maybeOrder)) {
    for (const entry of maybeOrder) {
      if (typeof entry !== "string") continue;
      if (!isValidTabValue(entry)) continue;
      const tabValue = entry as ValidTab;
      if (seen.has(tabValue)) continue;
      seen.add(tabValue);
      next.push(tabValue);
    }
  }

  // Append any missing tabs in a stable order (fallback first, then any new VALID_TABS).
  for (const tabValue of fallback) {
    if (!seen.has(tabValue)) {
      seen.add(tabValue);
      next.push(tabValue);
    }
  }

  for (const tabValue of VALID_TABS) {
    if (!seen.has(tabValue)) {
      seen.add(tabValue);
      next.push(tabValue);
    }
  }

  return next;
};

function readSearchParamList(
  searchParams: URLSearchParams,
  key: string,
): string[] {
  const rawValues = searchParams.getAll(key);
  return rawValues
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function readSearchParamNumber(
  searchParams: URLSearchParams,
  key: string,
): number | null {
  const rawValue = searchParams.get(key)?.trim();
  if (!rawValue) return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function readGraphComparisonOverlay(
  searchParams: URLSearchParams,
): AttackGraphComparisonOverlay | null {
  if (searchParams.get("graphComparison") !== "report-bundle") {
    return null;
  }

  const baseArtifactId = searchParams.get("graphBaseArtifactId")?.trim() || null;
  const targetArtifactId = searchParams.get("graphTargetArtifactId")?.trim() || null;
  const overlay: AttackGraphComparisonOverlay = {
    source: "report-bundle",
    ...(baseArtifactId ? { baseArtifactId } : {}),
    ...(targetArtifactId ? { targetArtifactId } : {}),
    baseRevision: readSearchParamNumber(searchParams, "graphBaseRevision"),
    targetRevision: readSearchParamNumber(searchParams, "graphTargetRevision"),
    addedNodeIds: readSearchParamList(searchParams, "graphAddedNodeIds"),
    removedNodeIds: readSearchParamList(searchParams, "graphRemovedNodeIds"),
    addedEdgeIds: readSearchParamList(searchParams, "graphAddedEdgeIds"),
    removedEdgeIds: readSearchParamList(searchParams, "graphRemovedEdgeIds"),
  };

  const hasGraphDelta =
    overlay.addedNodeIds.length > 0 ||
    overlay.removedNodeIds.length > 0 ||
    overlay.addedEdgeIds.length > 0 ||
    overlay.removedEdgeIds.length > 0;
  const hasArtifactPair = Boolean(baseArtifactId && targetArtifactId);

  return hasGraphDelta || hasArtifactPair ? overlay : null;
}

function buildGraphComparisonOverlayFromArtifactComparison(
  comparison: ReportBundleArtifactCompareResponse,
): AttackGraphComparisonOverlay {
  return {
    source: "report-bundle",
    baseArtifactId: comparison.base.id,
    targetArtifactId: comparison.target.id,
    baseRevision: comparison.base.reportRevision,
    targetRevision: comparison.target.reportRevision,
    addedNodeIds: comparison.graph.addedNodeIds,
    removedNodeIds: comparison.graph.removedNodeIds,
    addedEdgeIds: comparison.graph.addedEdgeIds,
    removedEdgeIds: comparison.graph.removedEdgeIds,
    addedNodes: comparison.graph.addedNodes,
    removedNodes: comparison.graph.removedNodes,
    addedEdges: comparison.graph.addedEdges,
    removedEdges: comparison.graph.removedEdges,
  };
}

const readStoredTabOrder = (
  projectId: string | undefined,
  key: string,
  fallback: readonly ValidTab[]
): ValidTab[] => {
  if (!projectId || typeof window === "undefined") return [...fallback];
  try {
    const raw = window.localStorage.getItem(
      `pwnpilot:project:${projectId}:${key}`
    );
    if (!raw) return [...fallback];
    return normalizeTabOrder(JSON.parse(raw), fallback);
  } catch {
    return [...fallback];
  }
};

const writeStoredBool = (
  projectId: string | undefined,
  key: string,
  value: boolean
) => {
  if (!projectId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `pwnpilot:project:${projectId}:${key}`,
      String(value)
    );
  } catch {
    // Ignore storage errors (private mode, quota, etc.)
  }
};

const writeStoredTab = (
  projectId: string | undefined,
  key: string,
  value: ValidTab
) => {
  if (!projectId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`pwnpilot:project:${projectId}:${key}`, value);
  } catch {
    // Ignore storage errors (private mode, quota, etc.)
  }
};

const writeStoredTabOrder = (
  projectId: string | undefined,
  key: string,
  value: readonly ValidTab[]
) => {
  if (!projectId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `pwnpilot:project:${projectId}:${key}`,
      JSON.stringify(value)
    );
  } catch {
    // Ignore storage errors (private mode, quota, etc.)
  }
};

const getFallbackParallelTab = (tabValue: ValidTab): ValidTab =>
  VALID_TABS.find((tab) => tab !== tabValue) ?? "terminal";

const isValidTabValue = (value: string): value is ValidTab =>
  VALID_TABS.includes(value as ValidTab);

const PANEL_FALLBACK_CLASS_NAME =
  "flex min-h-0 flex-1 items-center justify-center bg-background-dark text-sm text-slate-500";

const hasMatchingChecklistItem = (
  sections: EngagementChecklistSection[],
  node: EngagementGraphNode
): boolean =>
  Boolean(node.sectionId && node.itemId) &&
  sections.some(
    (section) =>
      section.id === node.sectionId &&
      section.items.some((item) => item.id === node.itemId)
  );

const isCommandEvidenceGraphNode = (
  node: EngagementGraphNode,
  sections: EngagementChecklistSection[]
): boolean =>
  hasMatchingChecklistItem(sections, node) &&
  !node.id.startsWith("manual-node-") &&
  !node.id.startsWith("graph-node:");

export function ProjectView() {
  const { projectId, tab } = useParams<{ projectId: string; tab?: string }>();
  const navigate = useNavigate();
  const updateProject = useProjectStore((state) => state.updateProject);
  const { project, error: projectError, isPending: isProjectPending } =
    useProjectDetail(projectId);
  const setQueuedCommand = useTerminalStore((state) => state.setQueuedCommand);
  const seedPrompt = useAIComposerStore((state) => state.seedPrompt);
  const projectAccessError = getProjectAccessErrorState(projectError);

  useEffect(() => {
    if (projectId && projectError && !projectAccessError) {
      navigate("/", { replace: true });
    }
  }, [navigate, projectAccessError, projectError, projectId]);

  if (projectAccessError && projectId) {
    return (
      <ProjectAccessState
        projectId={projectId}
        initialStatus={projectAccessError.membershipStatus}
        onBackToDashboard={() => navigate("/", { replace: true })}
      />
    );
  }

  if (isProjectPending || !project || project.id !== projectId) {
    return (
      <div className="flex h-full items-center justify-center bg-background-dark">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <ProjectViewShell
      key={project.id}
      projectId={projectId}
      tab={tab}
      project={project}
      updateProject={updateProject}
      setQueuedCommand={setQueuedCommand}
      seedPrompt={seedPrompt}
      navigate={navigate}
    />
  );
}

function ProjectViewShell({
  projectId,
  tab,
  project,
  updateProject,
  setQueuedCommand,
  seedPrompt,
  navigate,
}: {
  projectId: string | undefined;
  tab: string | undefined;
  project: NonNullable<ReturnType<typeof useProjectDetail>["project"]>;
  updateProject: ProjectStoreState["updateProject"];
  setQueuedCommand: TerminalStoreState["setQueuedCommand"];
  seedPrompt: ReturnType<typeof useAIComposerStore.getState>["seedPrompt"];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const queryClient = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredBool(projectId, "sidebarCollapsed", true)
  );
  const [graphCollapsed, setGraphCollapsed] = useState(true);
  const [selectedEvidenceItem, setSelectedEvidenceItem] =
    useState<SidebarEvidenceSelection | null>(null);
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(
    null
  );
  const [selectedGraphEdgeId, setSelectedGraphEdgeId] = useState<string | null>(
    null
  );
  const [parallelViewEnabled, setParallelViewEnabled] = useState(() =>
    readStoredBool(projectId, "parallelViewEnabled", false)
  );
  const [parallelTab, setParallelTab] = useState<ValidTab>(() =>
    readStoredTab(projectId, "parallelTab", "notes")
  );
  const [tabOrder, setTabOrder] = useState<ValidTab[]>(() =>
    readStoredTabOrder(projectId, "tabOrder", DEFAULT_TAB_ORDER)
  );
  const [draggedTab, setDraggedTab] = useState<ValidTab | null>(null);
  const [tabReorderIndicator, setTabReorderIndicator] = useState<{
    targetTab: ValidTab;
    position: "before" | "after";
  } | null>(null);
  const [tabContextMenu, setTabContextMenu] =
    useState<ProjectTabContextMenuState | null>(null);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isSeedingGraphDemo, setIsSeedingGraphDemo] = useState(false);
  const canReadGlobalSettings = useAuthStore(
    (state) => state.user?.is_super_admin === true
  );
  const [searchParams] = useSearchParams();
  const focusedGraphNodeId = searchParams.get("graphNodeId")?.trim() || null;
  const focusedGraphEdgeId = searchParams.get("graphEdgeId")?.trim() || null;
  const graphComparisonOverlay = useMemo(
    () => readGraphComparisonOverlay(searchParams),
    [searchParams],
  );
  const graphComparisonBaseArtifactId =
    graphComparisonOverlay?.baseArtifactId ?? null;
  const graphComparisonTargetArtifactId =
    graphComparisonOverlay?.targetArtifactId ?? null;
  const graphComparisonArtifactQuery = useQuery({
    queryKey:
      graphComparisonBaseArtifactId && graphComparisonTargetArtifactId
        ? reportQueryKeys.artifactComparison(
            project.id,
            graphComparisonBaseArtifactId,
            graphComparisonTargetArtifactId,
          )
        : ["report", project.id, "artifact-comparison", "idle"],
    queryFn: () =>
      compareReportBundleArtifacts(
        project.id,
        graphComparisonBaseArtifactId!,
        graphComparisonTargetArtifactId!,
      ),
    enabled: Boolean(
      graphComparisonBaseArtifactId && graphComparisonTargetArtifactId,
    ),
  });
  const fetchedGraphComparisonOverlay = useMemo(
    () =>
      graphComparisonArtifactQuery.data
        ? buildGraphComparisonOverlayFromArtifactComparison(
            graphComparisonArtifactQuery.data,
          )
        : null,
    [graphComparisonArtifactQuery.data],
  );
  const effectiveGraphComparisonOverlay =
    fetchedGraphComparisonOverlay ?? graphComparisonOverlay;
  const vpnStatusRefreshTimeoutsRef = useRef<number[]>([]);
  const lastVpnStatusErrorToastRef = useRef<string | null>(null);
  const vpnSettingsQuery = useQuery({
    queryKey: settingsQueryKeys.current,
    queryFn: fetchSettings,
    enabled: canReadGlobalSettings,
    retry: false,
  });
  const globalSettings = canReadGlobalSettings ? vpnSettingsQuery.data ?? null : null;
  const vpnStatusQuery = useQuery({
    queryKey: projectQueryKeys.vpnStatus(project.id),
    queryFn: () => fetchProjectVpnStatus(project.id),
    retry: false,
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!vpnStatusQuery.isError) {
      lastVpnStatusErrorToastRef.current = null;
      return;
    }

    const message = getUserFacingErrorMessage(
      vpnStatusQuery.error,
      "Could not refresh VPN status.",
    );
    const signature = `${project.id}:${message}`;
    if (lastVpnStatusErrorToastRef.current === signature) {
      return;
    }

    lastVpnStatusErrorToastRef.current = signature;
    toast.error("VPN status unavailable", { description: message });
  }, [project.id, vpnStatusQuery.error, vpnStatusQuery.isError]);
  const addReportEvidenceMutation = useMutation({
    mutationFn: (payload: CreateReportProposalPayload) =>
      createReportProposal(project.id, payload),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reportQueryKeys.detail(project.id) }),
        queryClient.invalidateQueries({ queryKey: reportQueryKeys.proposals(project.id) }),
        queryClient.invalidateQueries({ queryKey: reportQueryKeys.evidence(project.id) }),
      ]);
      toast.success(
        result.duplicate
          ? "Evidence already in report proposals"
          : "Evidence added to report proposals"
      );
    },
    onError: (error) =>
      showApiErrorToast(
        "Failed to add evidence to report",
        error,
        "Could not add this evidence to report proposals.",
      ),
  });
  const {
    engagementState,
    isLoading: isEngagementLoading,
    error: engagementError,
    toggleItem: handleEngagementItemToggle,
    toggleSection: handleEngagementSectionToggle,
    replaceState: replaceEngagementState,
    updateGraphNode: updateEngagementGraphNode,
    addGraphNode: addEngagementGraphNode,
    deleteGraphNode: deleteEngagementGraphNode,
    moveGraphNode: moveEngagementGraphNode,
  } = useProjectEngagement(project?.id);
  const evidenceCommandIds = engagementState.graph.nodes.flatMap((node) =>
    isCommandEvidenceGraphNode(node, engagementState.sections) ? [node.id] : []
  );

  const activeTab: ValidTab =
    tab && VALID_TABS.includes(tab as ValidTab)
      ? (tab as ValidTab)
      : "terminal";
  const vpnConnection = resolveProjectVpnConnection(
    project,
    globalSettings
  );
  const vpnStatus =
    vpnStatusQuery.data ??
    ({
      platform_id: "",
      platform_label: vpnConnection.buttonLabel
        .replace(/^Connect\s+/, "")
        .replace(/\s+VPN$/, "")
        .trim(),
      button_label: vpnConnection.buttonLabel,
      state: vpnConnection.command ? "disconnected" : "missing",
      command: vpnConnection.command,
      disconnect_command: null,
      config_path: vpnConnection.configPath,
      source_label: vpnConnection.sourceLabel,
      reason: vpnConnection.reason,
      connected_process_pid: null,
      connected_process_name: null,
      connected_process_command: null,
    } as const);
  const vpnState = vpnStatusQuery.isError
    ? "unknown"
    : vpnStatus.state;
  const vpnCommand =
    vpnState === "missing"
      ? null
      : vpnStatus.command ?? vpnConnection.command;
  const vpnActionLabel =
    vpnState === "connected"
      ? (vpnStatus.button_label || vpnConnection.buttonLabel).replace(
          /^Connect /,
          "Reconnect "
        )
      : vpnStatus.button_label || vpnConnection.buttonLabel;
  const vpnDisconnectCommand =
    vpnState === "connected" ? vpnStatus.disconnect_command ?? null : null;
  const vpnMenuLabel = (vpnStatus.button_label || vpnConnection.buttonLabel)
    .replace(/^Connect /, "")
    .trim();
  const vpnDisconnectLabel = vpnMenuLabel
    ? `Disconnect ${vpnMenuLabel}`
    : "Disconnect VPN";
  const vpnStatusLabel =
    vpnState === "connected"
      ? "VPN connected"
      : vpnState === "disconnected"
      ? "VPN disconnected"
      : vpnState === "missing"
      ? "VPN not configured"
      : "VPN status unavailable";
  const vpnStatusClassName =
    vpnState === "connected"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : vpnState === "disconnected"
      ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
      : vpnState === "missing"
      ? "border-red-400/20 bg-red-400/10 text-red-100"
      : "border-slate-400/20 bg-slate-400/10 text-slate-100";
  const vpnIndicatorClassName =
    vpnState === "connected"
      ? "bg-emerald-400"
      : vpnState === "disconnected"
      ? "bg-amber-400"
      : vpnState === "missing"
      ? "bg-red-400"
      : "bg-slate-300";
  const vpnStatusTitle = [
    `${vpnStatus.platform_label || "VPN"} status`,
    `State: ${vpnStatusLabel}`,
    vpnStatus.config_path ? `Path: ${vpnStatus.config_path}` : null,
    vpnStatus.source_label ? `Source: ${vpnStatus.source_label}` : null,
    vpnStatus.connected_process_name && vpnStatus.connected_process_pid
      ? `Process: ${vpnStatus.connected_process_name} (${vpnStatus.connected_process_pid})`
      : null,
    vpnStatus.reason,
  ]
    .filter(Boolean)
    .join(" • ");
  const hasVpnActions = Boolean(vpnCommand || vpnDisconnectCommand);
  const vpnStatusControlContent = (
    <>
      {vpnStatusQuery.isFetching ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <span
          className={`h-2 w-2 rounded-full ${vpnIndicatorClassName}`}
          aria-hidden="true"
        />
      )}
      <span className="hidden xl:inline text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/90">
        {vpnStatus.platform_label || "VPN"}
      </span>
      <span className="text-xs">{vpnStatusLabel}</span>
      {hasVpnActions ? <ChevronDown className="h-3 w-3 opacity-70" /> : null}
    </>
  );

  useEffect(() => {
    if (!tabContextMenu) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTabContextMenu(null);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [tabContextMenu]);

  useEffect(() => {
    setGraphCollapsed(true);
  }, [projectId]);

  useEffect(() => {
    if (!focusedGraphNodeId && !focusedGraphEdgeId && !effectiveGraphComparisonOverlay) return;

    setGraphCollapsed(false);
    if (focusedGraphNodeId) {
      setSelectedGraphNodeId(focusedGraphNodeId);
      setSelectedGraphEdgeId(null);
      return;
    }
    setSelectedGraphNodeId(null);
    setSelectedGraphEdgeId(focusedGraphEdgeId);
  }, [focusedGraphEdgeId, focusedGraphNodeId, effectiveGraphComparisonOverlay]);

  useEffect(() => {
    return () => {
      vpnStatusRefreshTimeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      vpnStatusRefreshTimeoutsRef.current = [];
    };
  }, []);

  const handleTabChange = (value: string) => {
    if (value === "terminal") {
      navigate(`/projects/${projectId}`);
    } else {
      navigate(`/projects/${projectId}/${value}`);
    }
  };

  const handleCopyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
  };

  const handleRunCommand = (command: string) => {
    setQueuedCommand(command);
    if (projectId) {
      navigate(`/projects/${projectId}`);
    }
  };

  const scheduleVpnStatusRefresh = () => {
    if (typeof window !== "undefined") {
      vpnStatusRefreshTimeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      vpnStatusRefreshTimeoutsRef.current = [];

      const firstTimeout = window.setTimeout(() => {
        void vpnStatusQuery.refetch();
      }, 1500);
      const secondTimeout = window.setTimeout(() => {
        void vpnStatusQuery.refetch();
      }, 5000);
      vpnStatusRefreshTimeoutsRef.current.push(firstTimeout, secondTimeout);
    }
  };

  const handleVpnCommand = (command: string | null) => {
    if (!command) return;
    handleRunCommand(command);
    scheduleVpnStatusRefresh();
  };

  const handleConnectVpn = () => {
    handleVpnCommand(vpnCommand);
  };

  const handleDisconnectVpn = () => {
    handleVpnCommand(vpnDisconnectCommand);
  };

  const handleSendToAI = (
    text: string,
    source: "timeline" | "commands" | "terminal" | "graph" = "timeline"
  ) => {
    seedPrompt(text, source);
    navigate(`/projects/${project.id}/ai`);
  };

  const handleAddEvidenceToReport = (payload: CreateReportProposalPayload) =>
    addReportEvidenceMutation.mutateAsync(payload);

  const handleOpenReportEvidence = (target: ReportEvidenceUsageTarget) => {
    navigate(
      `/projects/${target.projectId}/reports?proposal=${encodeURIComponent(
        target.proposalId
      )}`
    );
  };

  const handleSidebarCollapsedChange = (next: boolean) => {
    setSidebarCollapsed(next);
    writeStoredBool(projectId, "sidebarCollapsed", next);
  };

  const handleRevealCommandEvidence = (commandId: string) => {
    const node = engagementState.graph.nodes.find(
      (candidate) =>
        candidate.id === commandId &&
        isCommandEvidenceGraphNode(candidate, engagementState.sections)
    );

    if (!node?.sectionId || !node.itemId) {
      return;
    }

    setSelectedEvidenceItem({
      sectionId: node.sectionId,
      itemId: node.itemId,
    });
    setSelectedGraphNodeId(node.id);
    setSelectedGraphEdgeId(null);
    setSidebarCollapsed(false);
    writeStoredBool(projectId, "sidebarCollapsed", false);
    setGraphCollapsed(false);
  };

  const handleGraphToggle = () => {
    setGraphCollapsed((prev) => !prev);
  };

  const handleParallelToggle = () => {
    if (!parallelViewEnabled && parallelTab === activeTab) {
      const fallback = getFallbackParallelTab(activeTab);
      setParallelTab(fallback);
      writeStoredTab(projectId, "parallelTab", fallback);
    }

    setParallelViewEnabled((prev) => {
      const next = !prev;
      writeStoredBool(projectId, "parallelViewEnabled", next);
      return next;
    });
  };

  const openParallelForTab = (requestedTab: ValidTab, mainTab: ValidTab) => {
    const nextTab =
      requestedTab === mainTab ? getFallbackParallelTab(mainTab) : requestedTab;
    setParallelTab(nextTab);
    writeStoredTab(projectId, "parallelTab", nextTab);
    setParallelViewEnabled((prev) => {
      if (!prev) {
        writeStoredBool(projectId, "parallelViewEnabled", true);
      }
      return true;
    });
  };

  const handleParallelTabChange = (value: string, mainTab: ValidTab) => {
    if (!VALID_TABS.includes(value as ValidTab)) return;
    const nextTab = value as ValidTab;
    if (nextTab === mainTab) return;
    setParallelTab(nextTab);
    writeStoredTab(projectId, "parallelTab", nextTab);
  };

  const handleTabContextMenu = (
    event: MouseEvent,
    tabValue: ValidTab
  ) => {
    event.preventDefault();
    setTabContextMenu({ tabValue, x: event.clientX, y: event.clientY });
  };

  const handleTabDragStart = (
    event: DragEvent<HTMLElement>,
    tabValue: ValidTab
  ) => {
    setTabReorderIndicator(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PROJECT_TAB_DRAG_MIME, tabValue);
    event.dataTransfer.setData("text/plain", tabValue);
    setDraggedTab(tabValue);
  };

  const handleTabDragEnd = () => {
    setDraggedTab(null);
    setTabReorderIndicator(null);
  };

  const readDroppedTab = (event: DragEvent<HTMLElement>): ValidTab | null => {
    const rawValue =
      event.dataTransfer.getData(PROJECT_TAB_DRAG_MIME) ||
      event.dataTransfer.getData("text/plain");
    return isValidTabValue(rawValue) ? rawValue : null;
  };

  const handleSplitDragOver = (event: DragEvent<HTMLElement>) => {
    if (draggedTab || readDroppedTab(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setTabReorderIndicator(null);
    }
  };

  const handleSplitDrop = (event: DragEvent<HTMLElement>, mainTab: ValidTab) => {
    event.preventDefault();
    const droppedTab = readDroppedTab(event);
    setDraggedTab(null);
    setTabReorderIndicator(null);
    if (!droppedTab) return;
    openParallelForTab(droppedTab, mainTab);
  };

  const reorderTabs = (
    order: readonly ValidTab[],
    dragged: ValidTab,
    target: ValidTab,
    position: "before" | "after"
  ): ValidTab[] => {
    if (dragged === target) return [...order];
    const fromIndex = order.indexOf(dragged);
    const toIndex = order.indexOf(target);
    if (fromIndex === -1 || toIndex === -1) return [...order];

    const next = order.filter((tabValue) => tabValue !== dragged);
    const insertIndex = next.indexOf(target);
    if (insertIndex === -1) return [...order];
    const normalizedIndex =
      position === "after"
        ? Math.min(insertIndex + 1, next.length)
        : insertIndex;
    next.splice(normalizedIndex, 0, dragged);
    return next;
  };

  const resolveDraggedTab = (event: DragEvent<HTMLElement>): ValidTab | null =>
    draggedTab ?? readDroppedTab(event);

  const getReorderDropPosition = (
    event: DragEvent<HTMLElement>
  ): "before" | "after" => {
    const element = event.currentTarget as HTMLElement | null;
    const rect = element?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return "before";
    const midpoint = rect.left + rect.width / 2;
    const rawClientX = (event as unknown as { clientX?: number }).clientX;
    const clientX = Number.isFinite(rawClientX)
      ? (rawClientX as number)
      : Number.isFinite((event as unknown as { nativeEvent?: { clientX?: number } }).nativeEvent?.clientX)
        ? (event as unknown as { nativeEvent?: { clientX?: number } }).nativeEvent!.clientX!
        : 0;
    return clientX < midpoint ? "before" : "after";
  };

  const handleTabReorderDragOver = (
    event: DragEvent<HTMLElement>,
    targetTab: ValidTab
  ) => {
    const candidate = resolveDraggedTab(event);
    if (!candidate || candidate === targetTab) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const position = getReorderDropPosition(event);
    setTabReorderIndicator((prev) => {
      if (
        prev?.targetTab === targetTab &&
        prev.position === position
      ) {
        return prev;
      }
      return { targetTab, position };
    });
  };

  const handleTabReorderDrop = (
    event: DragEvent<HTMLElement>,
    targetTab: ValidTab
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedTab = resolveDraggedTab(event);
    setDraggedTab(null);
    const position =
      tabReorderIndicator?.targetTab === targetTab
        ? tabReorderIndicator.position
        : getReorderDropPosition(event);
    setTabReorderIndicator(null);
    if (!droppedTab || droppedTab === targetTab) return;

    setTabOrder((prev) => {
      const next = reorderTabs(prev, droppedTab, targetTab, position);
      writeStoredTabOrder(projectId, "tabOrder", next);
      return next;
    });
  };

  const handleSetupSave = async (payload: {
    variables: ProjectVariables;
    status?: string;
  }) => {
    try {
      const nextVariables = {
        ...project.variables,
        ...payload.variables,
      };
      const updatePayload = {
        variables: nextVariables,
        ...(payload.status ? { status: payload.status } : {}),
      };
      await updateProject(project.id, updatePayload);
    } catch (error) {
      console.error("Failed to save project setup", error);
    }
  };

  const handleContextSave = async (variables: ProjectVariables) => {
    try {
      await updateProject(project.id, { variables });
    } catch (error) {
      console.error("Failed to save project context", error);
    }
  };

  const handleLoadGraphDemo = async (profileId?: EngagementDemoProfileId) => {
    setIsSeedingGraphDemo(true);
    try {
      const { buildVisualMapDemoState } = await import(
        "@/lib/engagement/demoScenario"
      );
      await replaceEngagementState(
        buildVisualMapDemoState(project.type, profileId)
      );
    } finally {
      setIsSeedingGraphDemo(false);
    }
  };

  const handleGraphNodeUpdate = async (
    nodeId: string,
    patch: Partial<
      Pick<
        EngagementGraphNode,
        "title" | "subtitle" | "icon" | "sectionId" | "itemId" | "status" | "position"
      >
    >
  ) => {
    await updateEngagementGraphNode(nodeId, patch);
  };

  const handleGraphNodeAdd = async (afterNodeId?: string | null) => {
    await addEngagementGraphNode(afterNodeId);
  };

  const handleGraphNodeDelete = async (nodeId: string) => {
    await deleteEngagementGraphNode(nodeId);
  };

  const handleGraphNodeMove = async (
    nodeId: string,
    position: EngagementGraphNode["position"]
  ) => {
    await moveEngagementGraphNode(nodeId, position);
  };

  const renderTabContent = (tabValue: ValidTab) => {
    switch (tabValue) {
      case "terminal":
        return (
          <LazyBoundary
            fallbackLabel="Loading terminal"
            fallbackClassName={PANEL_FALLBACK_CLASS_NAME}
          >
            <AdvancedTerminalPanel
              projectId={project.id}
              onSendToAI={(text: string) => handleSendToAI(text, "terminal")}
            />
          </LazyBoundary>
        );
      case "commands":
        return (
          <div className="flex-1 overflow-y-auto bg-background-dark">
            <div className="flex min-h-full w-full flex-col gap-6 px-6 py-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">
                    Project Command Library
                  </h2>
                  <p className="text-sm text-slate-400">
                    Browse global commands and project-specific commands in one place.
                  </p>
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link to={`/projects/${project.id}/commands/settings`}>
                    Manage Commands
                  </Link>
                </Button>
              </div>

              <LazyBoundary
                fallbackLabel="Loading commands"
                fallbackClassName="flex min-h-[320px] items-center justify-center rounded-xl border border-white/5 bg-[#121722] text-sm text-slate-500"
              >
                <CommandsLibraryPanel
                  scope="project"
                  projectId={project.id}
                  variables={project.variables}
                  onCopyCommand={handleCopyCommand}
                  onRunCommand={handleRunCommand}
                  onAskAI={(text: string) => handleSendToAI(text, "commands")}
                  fullPageScroll
                />
              </LazyBoundary>
            </div>
          </div>
        );
      case "context":
        return (
          <LazyBoundary
            fallbackLabel="Loading project context"
            fallbackClassName={PANEL_FALLBACK_CLASS_NAME}
          >
            <ProjectContextPanel
              projectType={project.type}
              variables={project.variables}
              onSave={handleContextSave}
            />
          </LazyBoundary>
        );
      case "notes":
        return (
          <LazyBoundary
            fallbackLabel="Loading notes"
            fallbackClassName={PANEL_FALLBACK_CLASS_NAME}
          >
            <ProjectKnowledgeBase embedded projectId={project.id} />
          </LazyBoundary>
        );
      case "ai":
        return (
          <LazyBoundary
            fallbackLabel="Loading AI assistant"
            fallbackClassName={PANEL_FALLBACK_CLASS_NAME}
          >
            <AIChatPanel projectId={project.id} />
          </LazyBoundary>
        );
      case "reports":
        return (
          <LazyBoundary
            fallbackLabel="Loading reports"
            fallbackClassName={PANEL_FALLBACK_CLASS_NAME}
          >
            <ProjectReportsPage />
          </LazyBoundary>
        );
      case "timeline":
        return (
          <LazyBoundary
            fallbackLabel="Loading history"
            fallbackClassName={PANEL_FALLBACK_CLASS_NAME}
          >
            <TimelinePanel
              projectId={project.id}
              onSendToAI={(text: string) => handleSendToAI(text, "timeline")}
              evidenceCommandIds={evidenceCommandIds}
              onRevealCommandEvidence={handleRevealCommandEvidence}
            />
          </LazyBoundary>
        );
      case "team":
        return (
          <div className="flex-1 overflow-auto p-6">
            <LazyBoundary
              fallbackLabel="Loading team"
              fallbackClassName={PANEL_FALLBACK_CLASS_NAME}
            >
              <ProjectTeamSection projectId={project.id} />
            </LazyBoundary>
          </div>
        );
      default:
        return null;
    }
  };

  const renderTabLayout = (mainTab: ValidTab) => {
    if (!parallelViewEnabled) {
      return (
        <div
          className="relative flex min-h-0 flex-1 overflow-hidden"
          onDragOver={handleSplitDragOver}
          onDrop={(event) => handleSplitDrop(event, mainTab)}
        >
          {renderTabContent(mainTab)}
          {draggedTab && (
            <div
              data-testid="project-split-dropzone"
              className="absolute bottom-4 right-4 top-4 z-20 flex w-56 items-center justify-center rounded-lg border border-dashed border-primary/60 bg-card-dark/95 px-4 text-center text-xs font-medium text-slate-200 shadow-lg"
              onDragOver={handleSplitDragOver}
              onDrop={(event) => handleSplitDrop(event, mainTab)}
            >
              Drop tab here to split view
            </div>
          )}
        </div>
      );
    }

    const parallelOptions = VALID_TABS.filter(
      (tabValue) => tabValue !== mainTab
    );
    const sideTab =
      parallelTab === mainTab ? getFallbackParallelTab(mainTab) : parallelTab;

    return (
      <Group orientation="horizontal" className="flex min-h-0 flex-1">
        <Panel id={`${mainTab}-panel-main`} minSize={35} defaultSize={50}>
          <div className="flex h-full min-w-0 flex-col overflow-hidden">
            {renderTabContent(mainTab)}
          </div>
        </Panel>
        <Separator className="w-px shrink-0 bg-border-dark/80" />
        <Panel id={`${mainTab}-panel-side`} minSize={25} defaultSize={50}>
          <div
            className="flex h-full min-w-0 flex-col border-l border-border-dark/70 bg-background-dark/30"
            data-testid="parallel-pane"
            onDragOver={handleSplitDragOver}
            onDrop={(event) => handleSplitDrop(event, mainTab)}
          >
            <Tabs
              value={sideTab}
              onValueChange={(value) =>
                handleParallelTabChange(value, mainTab)
              }
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <div className="flex h-10 items-center gap-2 border-b border-border-dark px-2 shrink-0">
                <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Split
                </span>
                <TabsList className="h-7 flex-1 justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
                  {parallelOptions.map((tabValue) => (
                    <TabsTrigger
                      key={tabValue}
                      value={tabValue}
                      draggable
                      onContextMenu={(event) => handleTabContextMenu(event, tabValue)}
                      onDragStart={(event) => handleTabDragStart(event, tabValue)}
                      onDragEnd={handleTabDragEnd}
                      className="h-7 border-b-2 border-transparent px-2 text-[11px] text-slate-400 data-[state=active]:border-primary data-[state=active]:bg-white/5 data-[state=active]:text-primary rounded-none"
                    >
                      {TAB_LABELS[tabValue]}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-500 hover:text-slate-200"
                  aria-label="Close parallel view"
                  onClick={handleParallelToggle}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {parallelOptions.map((tabValue) => (
                <TabsContent
                  key={tabValue}
                  value={tabValue}
                  className="m-0 flex-1 overflow-hidden outline-none data-[state=active]:flex"
                >
                  {renderTabContent(tabValue)}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </Panel>
      </Group>
    );
  };

  return (
    <div className="flex h-full overflow-hidden bg-background-dark">
      <Sidebar
        projectId={project.id}
        collapsed={sidebarCollapsed}
        onCollapsedChange={handleSidebarCollapsedChange}
        sections={engagementState.sections}
        graphNodes={engagementState.graph.nodes}
        progress={engagementState.progress}
        isLoading={isEngagementLoading}
        errorMessage={engagementError}
        onToggleItem={handleEngagementItemToggle}
        onToggleSection={handleEngagementSectionToggle}
        selectedEvidenceItem={selectedEvidenceItem}
        onSelectedEvidenceItemChange={setSelectedEvidenceItem}
      />

      <main className="flex-1 flex flex-col min-w-0 relative">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="h-12 border-b border-border-dark bg-surface-dark/95 px-2 flex items-center justify-between shrink-0">
            <TabsList className="bg-transparent gap-2 h-10 p-0">
              {tabOrder.map((tabValue) => {
                const Icon = TAB_ICONS[tabValue];
                const reorderPosition =
                  tabReorderIndicator?.targetTab === tabValue
                    ? tabReorderIndicator.position
                    : null;

                return (
                  <TabsTrigger
                    key={tabValue}
                    value={tabValue}
                    draggable
                    data-reorder={reorderPosition ?? undefined}
                    onContextMenu={(event) => handleTabContextMenu(event, tabValue)}
                    onDragStart={(event) => handleTabDragStart(event, tabValue)}
                    onDragEnd={handleTabDragEnd}
                    onDragOver={(event) => handleTabReorderDragOver(event, tabValue)}
                    onDrop={(event) => handleTabReorderDrop(event, tabValue)}
                    className={[
                      "relative transition-colors data-[state=active]:bg-white/5 data-[state=active]:text-primary text-slate-400 gap-2 h-9 border-b-2 border-transparent data-[state=active]:border-primary rounded-none shadow-none",
                      draggedTab === tabValue ? "opacity-60" : "",
                      reorderPosition
                        ? "bg-white/10"
                        : "",
                      reorderPosition === "before"
                        ? "before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:rounded-full before:bg-primary before:shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                        : "",
                      reorderPosition === "after"
                        ? "after:content-[''] after:absolute after:right-0 after:top-1 after:bottom-1 after:w-[2px] after:rounded-full after:bg-primary after:shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                        : "",
                    ].join(" ")}
                  >
                    <Icon className="h-4 w-4" />
                    {TAB_LABELS[tabValue]}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <div className="flex items-center gap-1">
              {hasVpnActions ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`hidden lg:flex h-8 items-center gap-2 rounded-full border px-3 shadow-none ${vpnStatusClassName}`}
                      title={vpnStatusTitle}
                      aria-label={`${vpnMenuLabel || "VPN"} actions`}
                    >
                      {vpnStatusControlContent}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56 border-white/10 bg-slate-950 text-slate-100"
                  >
                    {vpnCommand ? (
                      <DropdownMenuItem
                        onClick={handleConnectVpn}
                        className="cursor-pointer focus:bg-white/10 focus:text-white"
                      >
                        {vpnActionLabel}
                      </DropdownMenuItem>
                    ) : null}
                    {vpnDisconnectCommand ? (
                      <DropdownMenuItem
                        onClick={handleDisconnectVpn}
                        className="cursor-pointer focus:bg-white/10 focus:text-white"
                      >
                        {vpnDisconnectLabel}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div
                  className={`hidden lg:flex h-8 items-center gap-2 rounded-full border px-3 ${vpnStatusClassName}`}
                  title={vpnStatusTitle}
                >
                  {vpnStatusControlContent}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate(`/projects/${projectId}/settings`)
                }
                className="h-8 text-xs text-slate-400 hover:text-white gap-2"
              >
                <Settings2 className="h-4 w-4" />
                Project Settings
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-500 hover:text-slate-200"
                aria-label="Toggle parallel view"
                title="Toggle parallel view"
                onClick={handleParallelToggle}
              >
                <LayoutPanelLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-500 hover:text-slate-200"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col relative">
            <TabsContent
              value="terminal"
              className="flex-1 m-0 overflow-hidden outline-none data-[state=active]:flex"
            >
              {renderTabLayout("terminal")}
            </TabsContent>

            <TabsContent
              value="commands"
              className="flex-1 m-0 overflow-hidden outline-none data-[state=active]:flex"
            >
              {renderTabLayout("commands")}
            </TabsContent>

            <TabsContent
              value="context"
              className="flex-1 m-0 overflow-hidden outline-none data-[state=active]:flex"
            >
              {renderTabLayout("context")}
            </TabsContent>

            <TabsContent
              value="ai"
              className="flex-1 m-0 overflow-hidden outline-none data-[state=active]:flex"
            >
              {renderTabLayout("ai")}
            </TabsContent>

            <TabsContent
              value="reports"
              className="flex-1 m-0 overflow-hidden outline-none data-[state=active]:flex"
            >
              {renderTabLayout("reports")}
            </TabsContent>

            <TabsContent
              value="notes"
              className="flex-1 m-0 overflow-hidden outline-none data-[state=active]:flex"
            >
              {renderTabLayout("notes")}
            </TabsContent>

            <TabsContent
              value="timeline"
              className="flex-1 m-0 overflow-hidden outline-none data-[state=active]:flex"
            >
              {renderTabLayout("timeline")}
            </TabsContent>

            <TabsContent
              value="team"
              className="flex-1 m-0 overflow-hidden outline-none data-[state=active]:flex"
            >
              {renderTabLayout("team")}
            </TabsContent>

            <AttackGraph
              projectId={project.id}
              nodes={engagementState.graph.nodes}
              edges={engagementState.graph.edges}
              source={engagementState.source}
              projectType={project.type}
              isCollapsed={graphCollapsed}
              onToggle={handleGraphToggle}
              isLoading={isEngagementLoading}
              errorMessage={engagementError}
              onLoadDemoScenario={handleLoadGraphDemo}
              onUpdateNode={handleGraphNodeUpdate}
              onAddNode={handleGraphNodeAdd}
              onDeleteNode={handleGraphNodeDelete}
              onMoveNode={handleGraphNodeMove}
              isLoadingDemo={isSeedingGraphDemo}
              selectedGraphNodeId={selectedGraphNodeId}
              selectedGraphEdgeId={selectedGraphEdgeId}
              comparisonOverlay={effectiveGraphComparisonOverlay}
              onSendEvidenceToAI={(text: string) => handleSendToAI(text, "graph")}
              onAddEvidenceToReport={handleAddEvidenceToReport}
              onOpenReportEvidence={handleOpenReportEvidence}
            />
          </div>
        </Tabs>

        {tabContextMenu && (
          <div
            className="fixed inset-0 z-50"
            onClick={() => setTabContextMenu(null)}
          >
            <div
              className="absolute min-w-36 rounded-md border border-border-dark bg-card-dark p-1 shadow-xl"
              style={{ top: tabContextMenu.y, left: tabContextMenu.x }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-white/10"
                onClick={() => {
                  openParallelForTab(tabContextMenu.tabValue, activeTab);
                  setTabContextMenu(null);
                }}
              >
                Split view
              </button>
            </div>
          </div>
        )}
      </main>

      <LazyBoundary fallback={null}>
        <ProjectSetupDialog
          open={isSetupOpen}
          onOpenChange={setIsSetupOpen}
          onSave={handleSetupSave}
          defaultValues={project.variables}
          defaultStatus={project.status}
          vpnPlatforms={getVpnPlatformList(vpnSettingsQuery.data ?? null)}
        />
      </LazyBoundary>
    </div>
  );
}
