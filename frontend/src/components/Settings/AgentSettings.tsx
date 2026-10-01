import { useEffect, useState } from 'react';
import {
  Bot, Plus, Trash2, TestTube, Loader2,
  Pencil, Zap, Star, FileText, Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAgentConfigStore } from '@/stores/agentConfigStore';
import { AGENT_TYPE_LABELS } from '@/types/agent';
import type { AgentType, AgentConfig } from '@/types/agent';
import { AgentConfigForm } from './AgentConfigForm';

const AGENT_DEFAULTS: Record<AgentType, { binary: string; model: string }> = {
  claude_code: { binary: 'claude', model: 'claude-sonnet-4-20250514' },
  codex: { binary: 'codex', model: 'codex-mini-latest' },
  custom: { binary: '', model: '' },
};

interface AgentPreset { label: string; type: AgentType; binary: string; model: string; icon: string }

const AGENT_PRESETS: AgentPreset[] = [
  { label: 'Claude Code', type: 'claude_code', binary: 'claude', model: 'claude-sonnet-4-20250514', icon: '🟠' },
  { label: 'Codex CLI', type: 'codex', binary: 'codex', model: 'codex-mini-latest', icon: '🟢' },
];

type FormMode = 'closed' | 'create' | 'edit';

export function AgentSettings() {
  const {
    configs, templates, isLoading, fetchConfigs, fetchTemplates,
    createConfig, updateConfig, deleteConfig, verifyBinary, instantiateTemplate,
  } = useAgentConfigStore();

  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [editingConfig, setEditingConfig] = useState<AgentConfig | null>(null);
  const [presetInit, setPresetInit] = useState<{ type: AgentType; name: string; binary: string; model: string } | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<number, { found: boolean; path?: string }>>({});
  const [instantiatingId, setInstantiatingId] = useState<number | null>(null);

  useEffect(() => { fetchConfigs(); fetchTemplates(); }, [fetchConfigs, fetchTemplates]);

  const openCreateForm = (preset?: AgentPreset) => {
    const p = preset ?? { type: 'claude_code' as AgentType, label: AGENT_TYPE_LABELS['claude_code'], binary: AGENT_DEFAULTS['claude_code'].binary, model: AGENT_DEFAULTS['claude_code'].model };
    setPresetInit({ type: p.type, name: preset?.label ?? AGENT_TYPE_LABELS[p.type], binary: p.binary, model: p.model });
    setEditingConfig(null);
    setFormMode('create');
  };

  const openEditForm = (c: AgentConfig) => {
    setEditingConfig(c);
    setPresetInit(null);
    setFormMode('edit');
  };

  const handleFormSubmit = async (data: {
    type: AgentType; name: string; binary: string; model: string;
    maxTurns: number; apiKey: string; envVars: Record<string, string>; isDefault: boolean;
    systemPrompt: string; description: string; commandTemplate: string;
  }) => {
    const hasEnvVars = Object.keys(data.envVars).length > 0;
    if (formMode === 'edit' && editingConfig) {
      await updateConfig(editingConfig.id, {
        display_name: data.name, binary_path: data.binary || null,
        default_model: data.model || null, max_turns: data.maxTurns, is_default: data.isDefault,
        system_prompt: data.systemPrompt || null, description: data.description || null,
        command_template: data.type === 'custom' ? data.commandTemplate || null : null,
        ...(data.apiKey ? { api_key: data.apiKey } : {}),
        ...(hasEnvVars ? { env_vars: data.envVars } : {}),
      });
    } else {
      await createConfig({
        agent_type: data.type, display_name: data.name || AGENT_TYPE_LABELS[data.type],
        binary_path: data.binary || null, default_model: data.model || null,
        max_turns: data.maxTurns, api_key: data.apiKey || null,
        env_vars: hasEnvVars ? data.envVars : null, is_default: data.isDefault,
        system_prompt: data.systemPrompt || null, description: data.description || null,
        command_template: data.type === 'custom' ? data.commandTemplate || null : null,
      });
    }
    setFormMode('closed');
  };

  const handleInstantiate = async (templateId: number) => {
    setInstantiatingId(templateId);
    try {
      await instantiateTemplate(templateId);
    } finally {
      setInstantiatingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this agent configuration?')) return;
    await deleteConfig(id);
  };

  const handleVerify = async (id: number) => {
    setVerifyingId(id);
    try {
      const result = await verifyBinary(id);
      setVerifyResults((prev) => ({ ...prev, [id]: { found: result.found, path: result.resolved_path ?? undefined } }));
    } catch {
      setVerifyResults((prev) => ({ ...prev, [id]: { found: false } }));
    }
    setVerifyingId(null);
  };

  const isFormOpen = formMode !== 'closed';

  return (
    <div>
      {/* Templates section */}
      {!isFormOpen && templates.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-1.5 mb-2">
            <FileText className="h-3 w-3 text-primary" />
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Templates</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {templates.map((t) => (
              <Card key={t.id} className="bg-black/20 border-white/5 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-200 truncate">{t.display_name}</span>
                  <Badge variant="outline" className="h-4 text-[7px] border-primary/20 text-primary shrink-0">
                    {AGENT_TYPE_LABELS[t.agent_type]}
                  </Badge>
                </div>
                {t.description && (
                  <p className="text-[10px] text-slate-500 mb-2 line-clamp-2">{t.description}</p>
                )}
                <Button variant="ghost" size="sm"
                  className="h-6 text-[10px] text-primary hover:text-primary/80 w-full"
                  onClick={() => handleInstantiate(t.id)}
                  disabled={instantiatingId === t.id}>
                  {instantiatingId === t.id
                    ? <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
                    : <Play className="h-2.5 w-2.5 mr-1" />}
                  Use Template
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-slate-500">Agent Configurations</h3>
        {!isFormOpen && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-primary hover:text-primary/80" onClick={() => openCreateForm()}>
            <Plus className="h-3 w-3 mr-1" /> Add Agent
          </Button>
        )}
      </div>

      {/* Quick Add preset grid */}
      {!isFormOpen && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="h-3 w-3 text-amber-400" />
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Quick Add</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {AGENT_PRESETS.map((preset) => (
              <button key={preset.label} type="button" onClick={() => openCreateForm(preset)} disabled={isLoading}
                className="flex items-center gap-1.5 rounded-md border border-white/5 bg-black/20 px-2.5 py-1.5 text-left text-xs text-slate-300 transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50">
                <span className="text-sm">{preset.icon}</span>
                <span className="truncate">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Config list */}
      <div className="space-y-2">
        {configs.length === 0 && !isFormOpen && (
          <div className="text-center py-6 text-slate-500 text-sm">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No agent configurations</p>
            <p className="text-xs mt-1">Pick a preset above or add a custom agent</p>
          </div>
        )}
        {configs.map((c) => {
          const vr = verifyResults[c.id];
          return (
            <Card key={c.id} className="bg-black/20 border-white/5 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bot className="h-4 w-4 text-slate-500 shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{c.display_name}</span>
                      <Badge variant="outline" className="h-4 text-[8px] border-white/10 text-slate-400">
                        {AGENT_TYPE_LABELS[c.agent_type]}
                      </Badge>
                      {c.is_default && (
                        <Badge variant="outline" className="h-4 text-[8px] border-amber-500/20 text-amber-400">
                          <Star className="h-2 w-2 mr-0.5" /> DEFAULT
                        </Badge>
                      )}
                      {c.has_api_key && (
                        <Badge variant="outline" className="h-4 text-[8px] border-emerald-500/20 text-emerald-400">KEY SET</Badge>
                      )}
                      {c.has_env_vars && (
                        <Badge variant="outline" className="h-4 text-[8px] border-blue-500/20 text-blue-400">
                          ENV ({c.env_var_keys.length})
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {c.default_model ?? 'No model set'}
                      {c.binary_path && ` | ${c.binary_path}`}
                      {` | max ${c.max_turns} turns`}
                      {vr && (
                        <span className={vr.found ? 'text-emerald-400' : 'text-red-400'}>
                          {' '}| Binary {vr.found ? 'found' : 'not found'}{vr.path ? ` (${vr.path})` : ''}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-400 hover:text-white"
                    onClick={() => handleVerify(c.id)} disabled={verifyingId === c.id}>
                    {verifyingId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-400 hover:text-white" onClick={() => openEditForm(c)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400/60 hover:text-red-400" onClick={() => handleDelete(c.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Create / Edit form */}
      {isFormOpen && (
        <AgentConfigForm
          mode={formMode as 'create' | 'edit'}
          isLoading={isLoading}
          initial={{
            type: editingConfig?.agent_type ?? presetInit?.type ?? 'claude_code',
            name: editingConfig?.display_name ?? presetInit?.name ?? '',
            binary: editingConfig?.binary_path ?? presetInit?.binary ?? '',
            model: editingConfig?.default_model ?? presetInit?.model ?? '',
            maxTurns: editingConfig?.max_turns ?? 10,
            envVarKeys: editingConfig?.env_var_keys ?? [],
            isDefault: editingConfig?.is_default ?? false,
            hasApiKey: editingConfig?.has_api_key ?? false,
            systemPrompt: editingConfig?.system_prompt ?? '',
            description: editingConfig?.description ?? '',
            commandTemplate: editingConfig?.command_template ?? '',
          }}
          onSubmit={handleFormSubmit}
          onCancel={() => setFormMode('closed')}
        />
      )}
    </div>
  );
}
