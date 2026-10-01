import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Upload, RotateCcw, ChevronDown, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiApi } from "@/api/ai";
import type { PromptTemplate } from "@/types/ai";

interface SystemPromptSelectorProps {
  /** "global" for operator-level, "project" for project-specific */
  scope: "global" | "project";
  description?: string;
}

function SystemPromptSelectorContent({
  scope,
  prompts,
  description,
}: {
  scope: SystemPromptSelectorProps["scope"];
  prompts: PromptTemplate[];
  description?: string;
}) {
  const queryClient = useQueryClient();
  const defaultPrompt = prompts.find((prompt) => prompt.is_default) ?? prompts[0] ?? null;
  const [selectedId, setSelectedId] = useState<number | null>(defaultPrompt?.id ?? null);
  const [content, setContent] = useState(defaultPrompt?.content ?? "");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useQuery({
    queryKey: ["ui", "dropdown-click-outside"],
    queryFn: async () => null,
    enabled: false,
  });

  const selectedPrompt = prompts.find((p) => p.id === selectedId);

  const handleSelectPrompt = (prompt: PromptTemplate) => {
    setSelectedId(prompt.id);
    setContent(prompt.content);
    setIsDropdownOpen(false);
  };

  const handleSetDefault = async () => {
    if (!selectedId) return;
    setIsSaving(true);
    try {
      await aiApi.setDefaultPrompt(selectedId);
      await queryClient.invalidateQueries({
        queryKey: ["ai", scope, "system-prompts"],
      });
    } catch {
      /* ignore */
    }
    setIsSaving(false);
  };

  const handleSaveAsNew = async () => {
    if (!newName.trim() || !content.trim()) return;
    setIsSaving(true);
    try {
      const newPrompt = await aiApi.createPrompt({
        type: "system",
        name: newName.trim(),
        category: "general",
        content,
      });
      await queryClient.invalidateQueries({
        queryKey: ["ai", scope, "system-prompts"],
      });
      setSelectedId(newPrompt.id);
      setNewName("");
      setIsCreating(false);
    } catch {
      /* ignore */
    }
    setIsSaving(false);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedPrompt?.name || "system-prompt"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setContent(reader.result as string);
    reader.readAsText(file);
  };

  const handleResetContent = () => {
    if (selectedPrompt) {
      setContent(selectedPrompt.content);
    }
  };

  return (
    <div>
      {description && <p className="mb-3 text-xs text-slate-500">{description}</p>}

      {/* Template Selector */}
      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Template</label>
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-white/10 bg-black/30 text-sm text-slate-200 hover:border-white/20 transition-colors"
          >
            <span className="flex items-center gap-2">
              {selectedPrompt?.name || "Select a template"}
              {selectedPrompt?.is_default && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                  Default
                </span>
              )}
              {selectedPrompt?.is_user_created && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-400">
                  Custom
                </span>
              )}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-slate-500 transition-transform ${
                isDropdownOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {isDropdownOpen && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-md border border-white/10 bg-[#0b0f17] shadow-xl">
              {prompts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectPrompt(p)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-white/5 transition-colors ${
                    p.id === selectedId ? "bg-primary/10" : ""
                  }`}
                >
                  <span className="flex items-center gap-2 text-slate-200">
                    {p.name}
                    {p.is_default && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        Default
                      </span>
                    )}
                    {p.is_user_created && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-400">
                        Custom
                      </span>
                    )}
                  </span>
                  {p.id === selectedId && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content Editor */}
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[200px] rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-primary/60 resize-y"
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />

      {/* Actions */}
      <div className="mt-4 flex flex-col gap-3">
        {/* File operations */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 text-slate-400 hover:text-white gap-1.5"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> Load File
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 text-slate-400 hover:text-white gap-1.5"
            onClick={handleDownload}
          >
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 text-slate-400 hover:text-white gap-1.5"
            onClick={handleResetContent}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>

        {/* Save as new / Set default */}
        <div className="flex items-center justify-between">
          {isCreating ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New template name..."
                className="flex-1 h-9 px-3 rounded-md border border-white/10 bg-black/30 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
                autoFocus
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreating(false)}
                className="border-white/10"
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveAsNew} disabled={isSaving}>
                Save
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 text-slate-400 hover:text-white gap-1.5"
                onClick={() => setIsCreating(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Save as New
              </Button>
              <Button
                onClick={handleSetDefault}
                disabled={isSaving || selectedPrompt?.is_default}
              >
                {isSaving
                  ? "Saving..."
                  : selectedPrompt?.is_default
                  ? "Already Default"
                  : "Set as Default"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SystemPromptSelector({ scope, description }: SystemPromptSelectorProps) {
  const promptsQuery = useQuery({
    queryKey: ["ai", scope, "system-prompts"],
    queryFn: () => aiApi.listSystemPrompts(),
  });
  const prompts = promptsQuery.data ?? [];
  const formKey = prompts
    .map((prompt) => `${prompt.id}:${prompt.is_default ? "default" : "custom"}`)
    .join("|");

  return (
    <SystemPromptSelectorContent
      key={formKey}
      scope={scope}
      prompts={prompts}
      description={description}
    />
  );
}
