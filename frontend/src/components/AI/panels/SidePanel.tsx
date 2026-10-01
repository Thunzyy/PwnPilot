import { useState, useEffect } from "react";
import { Bot, Activity, History, MessageSquareText, Brain, Paperclip, PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentBuilderPanel } from "./AgentBuilderPanel";
import { PromptsPanel } from "./PromptsPanel";
import { MemoriesPanel } from "./MemoriesPanel";
import { FilesPanel } from "./FilesPanel";
import { AgentToolCallsPanel } from "../AgentToolCallsPanel";
import { AgentMCPLogPanel } from "../AgentMCPLogPanel";
import { VariableInputModal } from "./VariableInputModal";
import type { PromptTemplate } from "@/types/ai";

const STORAGE_KEY = "pwnpilot:sidepanel:tab";

type TabId = "agent" | "activity" | "history" | "prompts" | "memories" | "files";

interface TabDef {
  id: TabId;
  label: string;
  icon: typeof Bot;
}

const TABS: TabDef[] = [
  { id: "agent", label: "Agent", icon: Bot },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "history", label: "History", icon: History },
  { id: "prompts", label: "Prompts", icon: MessageSquareText },
  { id: "memories", label: "Memories", icon: Brain },
  { id: "files", label: "Files", icon: Paperclip },
];

interface SidePanelProps {
  projectId: string | null;
  onClose: () => void;
  onInsertPrompt?: (text: string) => void;
}

export function SidePanel({ projectId, onClose, onInsertPrompt }: SidePanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved as TabId) || "agent";
  });
  const [variableModalTemplate, setVariableModalTemplate] = useState<PromptTemplate | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeTab);
  }, [activeTab]);

  const handleInsertWithVariables = (template: PromptTemplate) => {
    setVariableModalTemplate(template);
  };

  const handleVariableModalInsert = (interpolatedContent: string) => {
    if (onInsertPrompt) {
      onInsertPrompt(interpolatedContent);
    }
    setVariableModalTemplate(null);
  };

  return (
    <div className="h-full flex flex-col bg-[#0b0f17] border-l border-white/5">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          {TABS.find((t) => t.id === activeTab)?.label}
        </span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-white/10 transition-colors"
          title="Hide panel"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Tab icons */}
      <div className="flex items-center justify-around px-2 py-1.5 border-b border-white/5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md transition-colors",
                activeTab === tab.id
                  ? "text-primary bg-primary/10"
                  : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
              )}
              title={tab.label}
            >
              <Icon className="h-4 w-4" />
              <span className="text-[9px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === "agent" && <AgentBuilderPanel />}
        {activeTab === "activity" && <AgentToolCallsPanel />}
        {activeTab === "history" && <AgentMCPLogPanel />}
        {activeTab === "prompts" && (
          <PromptsPanel
            onInsert={onInsertPrompt}
            onInsertWithVariables={handleInsertWithVariables}
          />
        )}
        {activeTab === "memories" && <MemoriesPanel projectId={projectId} />}
        {activeTab === "files" && <FilesPanel projectId={projectId} />}
      </div>

      {/* Variable Input Modal */}
      {variableModalTemplate && (
        <VariableInputModal
          template={variableModalTemplate}
          onInsert={handleVariableModalInsert}
          onCancel={() => setVariableModalTemplate(null)}
        />
      )}
    </div>
  );
}
