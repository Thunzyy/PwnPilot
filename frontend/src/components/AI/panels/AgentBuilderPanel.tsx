import { useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentConfigStore } from "@/stores/agentConfigStore";
import { AGENT_TYPE_LABELS } from "@/types/agent";
import type { AgentType } from "@/types/agent";

export function AgentBuilderPanel() {
  const createConfig = useAgentConfigStore((s) => s.createConfig);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [agentType, setAgentType] = useState<AgentType>("claude_code");
  const [commandTemplate, setCommandTemplate] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await createConfig({
        agent_type: agentType,
        display_name: name.trim(),
        system_prompt: systemPrompt.trim() || null,
        description: description.trim() || null,
        command_template: agentType === "custom" ? commandTemplate.trim() || null : null,
        is_template: true,
      });
      setName(""); setDescription(""); setSystemPrompt("");
      setAgentType("claude_code"); setCommandTemplate("");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-1">
      <div className="space-y-1.5">
        <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Agent Type</span>
        <div className="flex gap-1.5">
          {(Object.entries(AGENT_TYPE_LABELS) as [AgentType, string][]).map(([type, label]) => (
            <button key={type} type="button" onClick={() => setAgentType(type)}
              className={`rounded-md border px-3 py-1 text-[11px] transition-colors ${
                agentType === type ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-white/10 bg-black/20 text-slate-400 hover:border-white/20"
              }`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Agent Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Recon Specialist" className="h-8 text-sm bg-white/[0.03] border-white/10" />
      </div>

      <div className="space-y-1.5">
        <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Description</span>
        <Input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description..." className="h-8 text-sm bg-white/[0.03] border-white/10" />
      </div>

      <div className="space-y-1.5">
        <span className="text-[11px] text-slate-400 uppercase tracking-wider block">System Prompt</span>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="You are a penetration testing assistant..."
          className="w-full bg-white/[0.03] border border-white/10 rounded-md p-2 text-sm text-slate-200 resize-none focus:outline-none focus:border-primary/50 min-h-[120px]" />
      </div>

      {agentType === "custom" && (
        <div className="space-y-1.5">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Command Template</span>
          <Input value={commandTemplate} onChange={(e) => setCommandTemplate(e.target.value)}
            placeholder='my-tool --prompt {prompt} --json' className="h-8 text-sm bg-white/[0.03] border-white/10 font-mono" />
        </div>
      )}

      <Button size="sm" onClick={handleSave}
        className="w-full h-8 bg-primary hover:bg-primary/90 text-white text-xs font-bold gap-2"
        disabled={!name.trim() || isSaving}>
        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Save as Template
      </Button>
    </div>
  );
}
