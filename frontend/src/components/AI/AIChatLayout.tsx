import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { PanelLeftClose, PanelLeft, PanelRight } from "lucide-react";
import { toast } from "sonner";
import { isAxiosError } from "axios";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chatStore";
import { useAIStore } from "@/stores/aiStore";
import { useAIComposerStore } from "@/stores/aiComposerStore";
import { ConversationSidebar } from "./ConversationSidebar";
import { ChatPanel } from "./ChatPanel";
import { AIOnboardingState } from "./AIOnboardingState";
import { SidePanel } from "./panels/SidePanel";

const SIDE_PANEL_KEY = "pwnpilot:sidepanel:open";

interface AIChatLayoutProps {
  projectId: string | null;
}

export function AIChatLayout({ projectId }: AIChatLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidePanelOpen, setSidePanelOpen] = useState(() => localStorage.getItem(SIDE_PANEL_KEY) === "true");
  const [initialMode, setInitialMode] = useState<"question" | "agent">("question");
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const isTempChat = useChatStore((s) => s.isTempChat);
  const createConversation = useChatStore((s) => s.createConversation);
  const startTempChat = useChatStore((s) => s.startTempChat);
  const pendingPrompt = useAIComposerStore((s) => s.pendingPrompt);
  const providers = useAIStore((s) => s.providers);
  const routings = useAIStore((s) => s.routings);
  const hasFetchedRoutings = useAIStore((s) => s.hasFetchedRoutings);
  const fetchRoutings = useAIStore((s) => s.fetchRoutings);
  const hasRequestedTempChatRef = useRef(false);

  const toggleSidePanel = useCallback((open: boolean) => {
    setSidePanelOpen(open);
    localStorage.setItem(SIDE_PANEL_KEY, String(open));
  }, []);

  useEffect(() => {
    if (hasFetchedRoutings) return;
    void fetchRoutings();
  }, [fetchRoutings, hasFetchedRoutings]);

  useEffect(() => {
    if (!pendingPrompt?.text) return;
    if (activeConversationId || isTempChat) return;
    if (hasRequestedTempChatRef.current) return;
    hasRequestedTempChatRef.current = true;
    startTempChat();
  }, [activeConversationId, isTempChat, pendingPrompt, startTempChat]);

  const defaultSelection = useMemo(() => {
    const routing = routings.find((entry) => entry.project_id == null && entry.context_type === "general");
    if (!routing) return null;
    const provider = providers.find((entry) => entry.id === routing.provider_config_id && entry.is_enabled);
    if (!provider) return null;
    return {
      providerId: provider.id,
      model: routing.model || provider.default_model,
    };
  }, [providers, routings]);

  useEffect(() => {
    if (hasRequestedTempChatRef.current) return;
    if (!defaultSelection) return;
    if (activeConversationId || isTempChat) return;
    hasRequestedTempChatRef.current = true;
    startTempChat();
  }, [activeConversationId, defaultSelection, isTempChat, startTempChat]);

  const handleNewChat = async (
    selection?: { model: string; providerConfigId: number },
  ) => {
    setInitialMode("question");
    try {
      await createConversation(projectId, selection ? {
        model: selection.model,
        providerConfigId: selection.providerConfigId,
      } : undefined);
    } catch (err) {
      const message = isAxiosError(err)
        ? err.response?.data?.error?.message ?? err.message
        : err instanceof Error
          ? err.message
          : "Could not create conversation";
      toast.error("New chat failed", { description: message });
    }
  };

  const handleOpenAgentWorkspace = useCallback(() => {
    setInitialMode("agent");
    startTempChat();
  }, [startTempChat]);

  const handleInsertPrompt = useCallback((text: string) => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "textarea[placeholder*='PwnPilot']"
    );
    if (textarea) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      nativeSetter?.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
    }
  }, []);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left sidebar */}
      {sidebarOpen && (
        <div className="w-[260px] shrink-0">
          <ConversationSidebar projectId={projectId} />
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Toggle buttons */}
        <div className="absolute top-2 left-2 z-10">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-slate-400 hover:text-white"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </Button>
        </div>

        {!sidePanelOpen && (
          <div className="absolute top-2 right-2 z-10">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-slate-400 hover:text-white"
              onClick={() => toggleSidePanel(true)}
              title="Open side panel"
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {activeConversationId || isTempChat ? (
          <ChatPanel
            key={`${projectId ?? "global"}:${activeConversationId ?? "temp"}:${initialMode}`}
            projectId={projectId}
            conversationId={activeConversationId}
            defaultSelection={defaultSelection}
            initialMode={initialMode}
          />
        ) : (
          <AIOnboardingState
            onNewChat={handleNewChat}
            onOpenAgentWorkspace={handleOpenAgentWorkspace}
          />
        )}
      </div>

      {/* Right side panel */}
      {sidePanelOpen && (
        <div className="w-[320px] shrink-0 transition-all">
          <SidePanel
            projectId={projectId}
            onClose={() => toggleSidePanel(false)}
            onInsertPrompt={handleInsertPrompt}
          />
        </div>
      )}
    </div>
  );
}
