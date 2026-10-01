import { useState } from 'react';
import { Plus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AGENT_TYPE_LABELS } from '@/types/agent';
import type { AgentType } from '@/types/agent';

interface EnvVar { key: string; value: string }

interface AgentConfigFormProps {
  mode: 'create' | 'edit';
  isLoading: boolean;
  initial: {
    type: AgentType;
    name: string;
    binary: string;
    model: string;
    maxTurns: number;
    envVarKeys: string[];
    isDefault: boolean;
    hasApiKey: boolean;
    systemPrompt?: string;
    description?: string;
    commandTemplate?: string;
  };
  onTypeChange?: (type: AgentType, defaults: { binary: string; model: string; name: string }) => void;
  onSubmit: (data: {
    type: AgentType; name: string; binary: string; model: string;
    maxTurns: number; apiKey: string; envVars: Record<string, string>; isDefault: boolean;
    systemPrompt: string; description: string; commandTemplate: string;
  }) => void;
  onCancel: () => void;
}

const AGENT_DEFAULTS: Record<AgentType, { binary: string; model: string }> = {
  claude_code: { binary: 'claude', model: 'claude-sonnet-4-20250514' },
  codex: { binary: 'codex', model: 'codex-mini-latest' },
  custom: { binary: '', model: '' },
};

export function AgentConfigForm({ mode, isLoading, initial, onSubmit, onCancel }: AgentConfigFormProps) {
  const [formType, setFormType] = useState<AgentType>(initial.type);
  const [name, setName] = useState(initial.name);
  const [binary, setBinary] = useState(initial.binary);
  const [model, setModel] = useState(initial.model);
  const [maxTurns, setMaxTurns] = useState(initial.maxTurns);
  const [apiKey, setApiKey] = useState('');
  const [envVars, setEnvVars] = useState<EnvVar[]>(initial.envVarKeys.map((k) => ({ key: k, value: '' })));
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [description, setDescription] = useState(initial.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt ?? '');
  const [commandTemplate, setCommandTemplate] = useState(initial.commandTemplate ?? '');

  const handleTypeChange = (type: AgentType) => {
    setFormType(type);
    setName(AGENT_TYPE_LABELS[type]);
    setBinary(AGENT_DEFAULTS[type].binary);
    setModel(AGENT_DEFAULTS[type].model);
  };

  const handleSubmit = () => {
    const record: Record<string, string> = {};
    for (const ev of envVars) { if (ev.key.trim()) record[ev.key.trim()] = ev.value; }
    onSubmit({ type: formType, name, binary, model, maxTurns, apiKey, envVars: record, isDefault, systemPrompt, description, commandTemplate });
  };

  return (
    <Card className="mt-3 bg-black/20 border-white/5 p-4">
      <h4 className="text-xs font-medium text-slate-300 mb-3">
        {mode === 'edit' ? 'Edit Agent' : 'New Agent Configuration'}
      </h4>
      <div className="space-y-3">
        {mode === 'create' && (
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider">Agent Type</label>
            <div className="flex gap-1.5 mt-1">
              {(Object.entries(AGENT_TYPE_LABELS) as [AgentType, string][]).map(([type, label]) => (
                <button key={type} type="button" onClick={() => handleTypeChange(type)}
                  className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                    formType === type ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-white/10 bg-black/20 text-slate-400 hover:border-white/20'
                  }`}>{label}</button>
              ))}
            </div>
          </div>
        )}

        <FormField label="Display Name">
          <Input placeholder="My Agent" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Description">
          <Input placeholder="Brief description..." value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <FormField label="System Prompt">
          <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Role-specific instructions for the agent..."
            className="w-full bg-black/20 border border-white/10 rounded-md p-2 text-xs text-slate-200 resize-none min-h-[80px] focus:outline-none focus:border-primary/50" />
        </FormField>
        {formType === 'custom' && (
          <FormField label="Command Template">
            <Input placeholder='my-tool --prompt {prompt} --json' value={commandTemplate}
              onChange={(e) => setCommandTemplate(e.target.value)} className="font-mono" />
          </FormField>
        )}
        <FormField label="Binary Path">
          <Input placeholder="Leave empty to use PATH lookup" value={binary} onChange={(e) => setBinary(e.target.value)} />
        </FormField>
        <FormField label="Default Model">
          <Input placeholder="Model identifier" value={model} onChange={(e) => setModel(e.target.value)} />
        </FormField>
        <FormField label="Max Turns">
          <Input type="number" min={1} max={500} className="w-32" value={maxTurns}
            onChange={(e) => setMaxTurns(Math.max(1, Math.min(500, parseInt(e.target.value) || 10)))} />
        </FormField>
        <FormField label="API Key">
          <Input type="password"
            placeholder={mode === 'edit' && initial.hasApiKey ? 'Leave empty to keep current key' : 'API key (stored encrypted)'}
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </FormField>

        {/* Env Vars */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider">Environment Variables</label>
            <Button variant="ghost" size="sm" className="h-6 text-[10px] text-primary"
              onClick={() => setEnvVars((p) => [...p, { key: '', value: '' }])}>
              <Plus className="h-2.5 w-2.5 mr-0.5" /> Add Variable
            </Button>
          </div>
          {envVars.length > 0 && (
            <div className="mt-1.5 space-y-1.5">
              {envVars.map((ev, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Input placeholder="VAR_NAME" className="flex-1 font-mono text-xs"
                    value={ev.key} onChange={(e) => setEnvVars((p) => p.map((v, i) => i === idx ? { ...v, key: e.target.value } : v))} />
                  <Input type="password" placeholder="value" className="flex-1 text-xs"
                    value={ev.value} onChange={(e) => setEnvVars((p) => p.map((v, i) => i === idx ? { ...v, value: e.target.value } : v))} />
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-400/60 hover:text-red-400"
                    onClick={() => setEnvVars((p) => p.filter((_, i) => i !== idx))}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)}
            className="rounded border-white/20 bg-black/30 text-primary focus:ring-primary/50" />
          <span className="text-xs text-slate-400">Set as default agent</span>
        </label>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-slate-400">Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {mode === 'edit' ? 'Save Changes' : 'Add Agent'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
