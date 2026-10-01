import { useEffect, useState } from 'react';
import {
  Bot,
  Plus,
  Trash2,
  TestTube,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Pencil,
  ChevronDown,
  Zap,
  ScanSearch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAIStore } from '@/stores/aiStore';
import { aiApi } from '@/api/ai';
import { ProviderBadge } from '@/components/AI/ProviderBadge';
import type {
  AIContextRoutingCreate,
  AIProvider,
  AIProviderCreate,
  AIRoutingContextType,
  CLIParseMode,
  DetectedCLIProvider,
  ProviderType,
} from '@/types/ai';
import { getProviderRuntimeHint } from '@/components/AI/providerStatus';

const PROVIDER_LABELS: Record<ProviderType, string> = {
  ollama: 'Ollama (Local)',
  openai_compat: 'OpenAI Compatible',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  cli: 'CLI Tool',
};

const PROVIDER_DEFAULTS: Record<ProviderType, { base_url: string; model: string; needs_key: boolean }> = {
  ollama: { base_url: 'http://localhost:11434', model: 'gemma3:latest', needs_key: false },
  openai_compat: { base_url: 'http://localhost:1234/v1', model: 'local-model', needs_key: false },
  openai: { base_url: '', model: 'gpt-4o', needs_key: true },
  anthropic: { base_url: '', model: 'claude-sonnet-4-20250514', needs_key: true },
  cli: { base_url: '', model: '', needs_key: false },
};

interface ProviderPreset {
  label: string;
  type: ProviderType;
  model: string;
  url: string;
  needsKey: boolean;
  icon: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'Claude', type: 'anthropic', model: 'claude-sonnet-4-20250514', url: '', needsKey: true, icon: '🟠' },
  { label: 'GPT-4o', type: 'openai', model: 'gpt-4o', url: '', needsKey: true, icon: '🟢' },
  { label: 'o3-mini', type: 'openai', model: 'o3-mini', url: '', needsKey: true, icon: '🟢' },
  { label: 'DeepSeek', type: 'openai_compat', model: 'deepseek-chat', url: 'https://api.deepseek.com/v1', needsKey: true, icon: '🔵' },
  { label: 'Groq', type: 'openai_compat', model: 'llama-3.3-70b-versatile', url: 'https://api.groq.com/openai/v1', needsKey: true, icon: '🟡' },
  { label: 'Kimi', type: 'openai_compat', model: 'moonshot-v1-128k', url: 'https://api.moonshot.cn/v1', needsKey: true, icon: '🟣' },
  { label: 'Mistral', type: 'openai_compat', model: 'mistral-large-latest', url: 'https://api.mistral.ai/v1', needsKey: true, icon: '🔴' },
  { label: 'Ollama', type: 'ollama', model: 'gemma3:latest', url: 'http://localhost:11434', needsKey: false, icon: '⚪' },
  { label: 'LM Studio', type: 'openai_compat', model: 'local-model', url: 'http://localhost:1234/v1', needsKey: false, icon: '⚫' },
];

const ROUTING_FEATURES: Array<{
  context: AIRoutingContextType;
  title: string;
  description: string;
}> = [
  {
    context: 'general',
    title: 'AI Assistant',
    description: 'Used by the AI tab and new chat defaults.',
  },
  {
    context: 'graph',
    title: 'Attack Graph',
    description: 'Used for attack-path and graph summaries.',
  },
  {
    context: 'reporting',
    title: 'Reports',
    description: 'Used for write-up drafting and report updates.',
  },
];

function showUrlField(type: ProviderType) {
  return PROVIDER_DEFAULTS[type].base_url !== '' || type === 'openai_compat';
}

function showKeyField(type: ProviderType) {
  return PROVIDER_DEFAULTS[type].needs_key;
}

const MODEL_RELEASE_PATTERN = /(20\d{2})-?([01]\d)-?([0-3]\d)(?!.*\d)/;

function normalizeComparable(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function getKnownDetectedCLIModels(
  detected: Pick<DetectedCLIProvider, 'default_model' | 'detected_models'>
) {
  const seen = new Set<string>();
  const models: string[] = [];

  for (const candidate of [...(detected.detected_models ?? []), detected.default_model]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;

    const normalized = normalizeComparable(trimmed);
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    models.push(trimmed);
  }

  return models;
}

function getModelReleaseScore(model: string) {
  const match = normalizeComparable(model).match(MODEL_RELEASE_PATTERN);
  if (!match) return null;
  return Number(`${match[1]}${match[2]}${match[3]}`);
}

function sortDetectedCLIModels(models: string[], preferredModel?: string) {
  const preferred = normalizeComparable(preferredModel);

  return models
    .map((model, index) => ({
      model,
      index,
      releaseScore: getModelReleaseScore(model),
      hasLatestTag: normalizeComparable(model).includes('latest'),
      isPreferred: normalizeComparable(model) === preferred,
    }))
    .sort((left, right) => {
      if (left.releaseScore !== right.releaseScore) {
        if (left.releaseScore == null) return 1;
        if (right.releaseScore == null) return -1;
        return right.releaseScore - left.releaseScore;
      }

      if (left.isPreferred !== right.isPreferred) {
        return left.isPreferred ? -1 : 1;
      }

      if (left.hasLatestTag !== right.hasLatestTag) {
        return left.hasLatestTag ? -1 : 1;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.model);
}

function getSuggestedDetectedCLIModel(
  detected: Pick<DetectedCLIProvider, 'default_model' | 'detected_models'>
) {
  const sortedModels = sortDetectedCLIModels(
    getKnownDetectedCLIModels(detected),
    detected.default_model
  );
  return sortedModels[0] ?? detected.default_model;
}

function getDetectedCLISelectionKey(detected: Pick<DetectedCLIProvider, 'name' | 'cli_command'>) {
  return `${normalizeComparable(detected.name)}::${normalizeComparable(detected.cli_command)}`;
}

function getAddableDetectedCLIModels(detected: DetectedCLIProvider, providers: AIProvider[]) {
  const normalizedCommand = normalizeComparable(detected.cli_command);
  const configuredModels = new Set(
    providers
      .filter(
        (provider) =>
          provider.provider_type === 'cli'
          && normalizeComparable(provider.cli_command) === normalizedCommand
      )
      .map((provider) => normalizeComparable(provider.default_model))
      .filter(Boolean)
  );

  return getKnownDetectedCLIModels(detected).filter(
    (model) => !configuredModels.has(normalizeComparable(model))
  );
}

export function AISettings() {
  const {
    providers,
    routings,
    fetchProviders,
    fetchRoutings,
    fetchModels,
    saveRoutings,
    createProvider,
    updateProvider,
    deleteProvider,
    testProvider,
    modelsCache,
    hasFetchedProviders,
    hasFetchedRoutings,
    isLoading,
  } = useAIStore();

  // Form state — shared between create & edit
  const [formMode, setFormMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formType, setFormType] = useState<ProviderType>('ollama');
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formKey, setFormKey] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formTemp, setFormTemp] = useState(0.7);
  const [formMaxTokens, setFormMaxTokens] = useState(4096);
  const [formTimeout, setFormTimeout] = useState(30);
  const [formCLICommand, setFormCLICommand] = useState('');
  const [formCLIArgsTemplate, setFormCLIArgsTemplate] = useState('{prompt}');
  const [formCLIInteractiveArgs, setFormCLIInteractiveArgs] = useState('');
  const [formParseMode, setFormParseMode] = useState<CLIParseMode>('markdown');
  const [detectedCLIs, setDetectedCLIs] = useState<DetectedCLIProvider[]>([]);
  const [selectedDetectedCLIModels, setSelectedDetectedCLIModels] = useState<Record<string, string>>({});
  const [isDetectingCLIs, setIsDetectingCLIs] = useState(false);
  const [resolvedCLI, setResolvedCLI] = useState<DetectedCLIProvider | null>(null);
  const [isResolvingCLI, setIsResolvingCLI] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { status: string; latency?: number; error?: string }>>({});
  const [routingDrafts, setRoutingDrafts] = useState<Record<AIRoutingContextType, { providerConfigId: string; model: string }>>({
    general: { providerConfigId: '', model: '' },
    graph: { providerConfigId: '', model: '' },
    reporting: { providerConfigId: '', model: '' },
  });

  useEffect(() => {
    if (hasFetchedProviders) return;
    void fetchProviders();
  }, [fetchProviders, hasFetchedProviders]);

  useEffect(() => {
    if (hasFetchedRoutings) return;
    void fetchRoutings();
  }, [fetchRoutings, hasFetchedRoutings]);

  useEffect(() => {
    for (const provider of providers) {
      if (!provider.is_enabled) continue;
      if (modelsCache[provider.id]) continue;
      void fetchModels(provider.id).catch(() => {});
    }
  }, [fetchModels, modelsCache, providers]);

  useEffect(() => {
    if (formMode !== 'create' || formType !== 'cli') {
      return;
    }

    const trimmedCommand = formCLICommand.trim();
    if (!trimmedCommand) {
      setResolvedCLI(null);
      setIsResolvingCLI(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void resolveCLIProvider(trimmedCommand);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [formCLICommand, formMode, formType]);

  useEffect(() => {
    const nextDrafts: Record<AIRoutingContextType, { providerConfigId: string; model: string }> = {
      general: { providerConfigId: '', model: '' },
      graph: { providerConfigId: '', model: '' },
      reporting: { providerConfigId: '', model: '' },
    };

    for (const feature of ROUTING_FEATURES) {
      const routing = routings.find((entry) => entry.context_type === feature.context);
      if (!routing) continue;
      const provider = providers.find((entry) => entry.id === routing.provider_config_id);
      nextDrafts[feature.context] = {
        providerConfigId: String(routing.provider_config_id),
        model: routing.model || provider?.default_model || '',
      };
    }

    setRoutingDrafts(nextDrafts);
  }, [providers, routings]);

  const resetForm = () => {
    setFormMode('closed');
    setEditingId(null);
    setFormName('');
    setFormUrl('');
    setFormKey('');
    setFormModel('');
    setFormTemp(0.7);
    setFormMaxTokens(4096);
    setFormTimeout(30);
    setFormCLICommand('');
    setFormCLIArgsTemplate('{prompt}');
    setFormCLIInteractiveArgs('');
    setFormParseMode('markdown');
    setResolvedCLI(null);
    setIsResolvingCLI(false);
    setShowAdvanced(false);
  };

  const openCreateForm = () => {
    const type: ProviderType = 'ollama';
    setFormMode('create');
    setEditingId(null);
    setFormType(type);
    setFormUrl(PROVIDER_DEFAULTS[type].base_url);
    setFormModel(PROVIDER_DEFAULTS[type].model);
    setFormName(PROVIDER_LABELS[type]);
    setFormTemp(0.7);
    setFormMaxTokens(4096);
    setFormTimeout(30);
    setFormCLICommand('');
    setFormCLIArgsTemplate('{prompt}');
    setFormCLIInteractiveArgs('');
    setFormParseMode('markdown');
    setResolvedCLI(null);
    setIsResolvingCLI(false);
  };

  const openEditForm = (p: AIProvider) => {
    setFormMode('edit');
    setEditingId(p.id);
    setFormType(p.provider_type);
    setFormName(p.name);
    setFormUrl(p.base_url || '');
    setFormKey('');
    setFormModel(p.default_model);
    setFormTemp(p.temperature);
    setFormMaxTokens(p.max_tokens);
    setFormTimeout(p.timeout_seconds);
    setFormCLICommand(p.cli_command || '');
    setFormCLIArgsTemplate(p.cli_args_template || '{prompt}');
    setFormCLIInteractiveArgs(p.cli_interactive_args || '');
    setFormParseMode(p.parse_mode || 'markdown');
    setResolvedCLI(null);
    setIsResolvingCLI(false);
  };

  const handleTypeChange = (type: ProviderType) => {
    setFormType(type);
    setFormUrl(PROVIDER_DEFAULTS[type].base_url);
    setFormModel(PROVIDER_DEFAULTS[type].model);
    setFormName(PROVIDER_LABELS[type]);
    setResolvedCLI(null);
    setIsResolvingCLI(false);
    if (type === 'cli') {
      setFormCLICommand('');
      setFormCLIArgsTemplate('{prompt}');
      setFormCLIInteractiveArgs('');
      setFormParseMode('markdown');
    }
  };

  const handlePresetClick = async (preset: ProviderPreset) => {
    if (!preset.needsKey) {
      // No key needed — create instantly
      await createProvider({
        provider_type: preset.type,
        name: preset.label,
        default_model: preset.model,
        base_url: preset.url || undefined,
      });
      return;
    }
    // Pre-fill form for presets that need a key
    setFormMode('create');
    setEditingId(null);
    setFormType(preset.type);
    setFormName(preset.label);
    setFormUrl(preset.url);
    setFormModel(preset.model);
    setFormKey('');
    setFormTemp(0.7);
    setFormMaxTokens(4096);
    setFormTimeout(30);
    setResolvedCLI(null);
    setIsResolvingCLI(false);
  };

  const applyResolvedCLI = (detected: DetectedCLIProvider) => {
    const previousResolvedCLI = resolvedCLI;
    const previousSuggestedModel = previousResolvedCLI
      ? getSuggestedDetectedCLIModel(previousResolvedCLI)
      : '';
    const nextSuggestedModel = getSuggestedDetectedCLIModel(detected);
    setResolvedCLI(detected);

    if (!formName.trim() || formName === PROVIDER_LABELS.cli || formName === previousResolvedCLI?.name) {
      setFormName(detected.name);
    }
    if (
      !formModel.trim()
      || formModel === previousSuggestedModel
    ) {
      setFormModel(nextSuggestedModel);
    }
    if (
      !formCLIArgsTemplate.trim()
      || formCLIArgsTemplate === '{prompt}'
      || formCLIArgsTemplate === (previousResolvedCLI?.cli_args_template ?? '')
    ) {
      setFormCLIArgsTemplate(detected.cli_args_template || '{prompt}');
    }
    if (
      !formCLIInteractiveArgs.trim()
      || formCLIInteractiveArgs === (previousResolvedCLI?.cli_interactive_args ?? '')
    ) {
      setFormCLIInteractiveArgs(detected.cli_interactive_args || '');
    }
    if (formParseMode === 'markdown' || formParseMode === previousResolvedCLI?.parse_mode) {
      setFormParseMode(detected.parse_mode);
    }
  };

  const resolveCLIProvider = async (command = formCLICommand): Promise<DetectedCLIProvider | null> => {
    const trimmedCommand = command.trim();
    if (formType !== 'cli' || !trimmedCommand) {
      setResolvedCLI(null);
      return null;
    }

    setIsResolvingCLI(true);
    try {
      const detected = await aiApi.resolveCLIProvider(trimmedCommand);
      if (!detected) {
        setResolvedCLI(null);
        return null;
      }
      applyResolvedCLI(detected);
      return detected;
    } finally {
      setIsResolvingCLI(false);
    }
  };

  const handleSubmit = async () => {
    if (formMode === 'edit' && editingId != null) {
      await updateProvider(editingId, {
        name: formName,
        default_model: formModel,
        base_url: formUrl || undefined,
        temperature: formTemp,
        max_tokens: formMaxTokens,
        timeout_seconds: formTimeout,
        ...(formKey ? { api_key: formKey } : {}),
      });
    } else {
      const detectedCLI = formType === 'cli'
        ? (await resolveCLIProvider(formCLICommand)) ?? resolvedCLI
        : null;
      const previousResolvedCLI = resolvedCLI;
      const previousSuggestedModel = previousResolvedCLI
        ? getSuggestedDetectedCLIModel(previousResolvedCLI)
        : '';
      const detectedSuggestedModel = detectedCLI
        ? getSuggestedDetectedCLIModel(detectedCLI)
        : '';
      const shouldUseDetectedName = formType === 'cli'
        && detectedCLI != null
        && (
          !formName.trim()
          || formName === PROVIDER_LABELS.cli
          || formName === previousResolvedCLI?.name
        );
      const shouldUseDetectedModel = formType === 'cli'
        && detectedCLI != null
        && (
          !formModel.trim()
          || formModel === previousSuggestedModel
        );
      const shouldUseDetectedArgsTemplate = formType === 'cli'
        && detectedCLI != null
        && (
          !formCLIArgsTemplate.trim()
          || formCLIArgsTemplate === '{prompt}'
          || formCLIArgsTemplate === (previousResolvedCLI?.cli_args_template ?? '')
        );
      const shouldUseDetectedInteractiveArgs = formType === 'cli'
        && detectedCLI != null
        && (
          !formCLIInteractiveArgs.trim()
          || formCLIInteractiveArgs === (previousResolvedCLI?.cli_interactive_args ?? '')
        );
      const shouldUseDetectedParseMode = formType === 'cli'
        && detectedCLI != null
        && (
          formParseMode === 'markdown'
          || formParseMode === previousResolvedCLI?.parse_mode
        );

      const data: AIProviderCreate = {
        provider_type: formType,
        name: shouldUseDetectedName ? detectedCLI.name : (formName || PROVIDER_LABELS[formType]),
        default_model: shouldUseDetectedModel
          ? detectedSuggestedModel
          : (formModel || PROVIDER_DEFAULTS[formType].model),
        base_url: formUrl || undefined,
        api_key: formKey || undefined,
        temperature: formTemp,
        max_tokens: formMaxTokens,
        timeout_seconds: formTimeout,
        ...(formType === 'cli'
          ? {
              cli_command: formCLICommand || detectedCLI?.cli_command || undefined,
              cli_args_template: shouldUseDetectedArgsTemplate
                ? (detectedCLI?.cli_args_template || undefined)
                : (formCLIArgsTemplate || undefined),
              cli_interactive_args: shouldUseDetectedInteractiveArgs
                ? (detectedCLI?.cli_interactive_args || undefined)
                : (formCLIInteractiveArgs || undefined),
              parse_mode: shouldUseDetectedParseMode
                ? detectedCLI.parse_mode
                : formParseMode,
              supports_streaming: detectedCLI?.supports_streaming,
              supports_resume: detectedCLI?.supports_resume,
              session_flag: detectedCLI?.session_flag,
              detected_version: detectedCLI?.detected_version,
              detected_models: detectedCLI?.detected_models,
            }
          : {}),
      };
      await createProvider(data);
    }
    resetForm();
  };

  const handleDetectCLIs = async () => {
    setIsDetectingCLIs(true);
    try {
      const detected = await aiApi.detectCLIProviders();
      setSelectedDetectedCLIModels({});
      setDetectedCLIs(detected);
    } finally {
      setIsDetectingCLIs(false);
    }
  };

  const handleDetectedCLICreate = async (detected: DetectedCLIProvider, defaultModel: string) => {
    await createProvider({
      provider_type: 'cli',
      name: detected.name,
      default_model: defaultModel,
      cli_command: detected.cli_command,
      cli_args_template: detected.cli_args_template,
      cli_interactive_args: detected.cli_interactive_args,
      cli_env: detected.cli_env,
      working_directory: detected.working_directory,
      parse_mode: detected.parse_mode,
      supports_streaming: detected.supports_streaming,
      supports_resume: detected.supports_resume,
      session_flag: detected.session_flag,
      detected_version: detected.detected_version,
      detected_models: detected.detected_models,
    });
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const result = await testProvider(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: result.status, latency: result.latency_ms ?? undefined, error: result.error_message ?? undefined },
      }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: 'error', error: 'Connection failed' },
      }));
    }
    setTestingId(null);
  };

  const enabledProviders = providers.filter((provider) => provider.is_enabled);

  const getRoutingModelOptions = (providerConfigId: string) => {
    const providerId = Number(providerConfigId);
    if (!Number.isFinite(providerId) || providerId <= 0) return [];

    const provider = providers.find((entry) => entry.id === providerId);
    if (!provider) return [];

    const options = new Set<string>();
    if (provider.default_model) options.add(provider.default_model);
    for (const model of provider.detected_models ?? []) {
      if (model.trim()) options.add(model);
    }
    for (const model of modelsCache[providerId]?.models ?? []) {
      if (model.id.trim()) options.add(model.id);
    }
    return [...options];
  };

  const handleRoutingProviderChange = (
    context: AIRoutingContextType,
    providerConfigId: string,
  ) => {
    const modelOptions = getRoutingModelOptions(providerConfigId);
    const provider = providers.find((entry) => String(entry.id) === providerConfigId);
    setRoutingDrafts((prev) => ({
      ...prev,
      [context]: {
        providerConfigId,
        model:
          prev[context].providerConfigId === providerConfigId && prev[context].model
            ? prev[context].model
            : modelOptions[0] ?? provider?.default_model ?? '',
      },
    }));
  };

  const handleRoutingModelChange = (
    context: AIRoutingContextType,
    model: string,
  ) => {
    setRoutingDrafts((prev) => ({
      ...prev,
      [context]: {
        ...prev[context],
        model,
      },
    }));
  };

  const handleSaveRoutings = async () => {
    const payload: AIContextRoutingCreate[] = ROUTING_FEATURES.flatMap(({ context }) => {
      const draft = routingDrafts[context];
      const providerConfigId = Number(draft.providerConfigId);
      if (!Number.isFinite(providerConfigId) || providerConfigId <= 0) {
        return [];
      }

      const provider = providers.find((entry) => entry.id === providerConfigId);
      return [{
        context_type: context,
        provider_config_id: providerConfigId,
        model: draft.model || provider?.default_model || null,
        project_id: null,
      }];
    });

    await saveRoutings(payload);
  };

  const statusIcon = (status: string | null) => {
    if (status === 'healthy') return <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />;
    if (status === 'unhealthy' || status === 'error') return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    return <AlertCircle className="h-3.5 w-3.5 text-slate-500" />;
  };

  const isFormOpen = formMode !== 'closed';
  const resolvedCLIModels = resolvedCLI
    ? sortDetectedCLIModels(
        getKnownDetectedCLIModels(resolvedCLI),
        resolvedCLI.default_model
      )
    : [];
  const resolvedCLIModelSelection = resolvedCLIModels.includes(formModel) ? formModel : '';
  const visibleDetectedCLIEntries = detectedCLIs.flatMap((detected) => {
    const addableModels = sortDetectedCLIModels(
      getAddableDetectedCLIModels(detected, providers),
      detected.default_model
    );
    if (addableModels.length === 0) {
      return [];
    }

    const selectionKey = getDetectedCLISelectionKey(detected);
    const selectedModel = addableModels.includes(selectedDetectedCLIModels[selectionKey])
      ? selectedDetectedCLIModels[selectionKey]
      : addableModels[0];

    return [{ detected, addableModels, selectedModel, selectionKey }];
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-slate-500">
          AI Providers
        </h3>
        {!isFormOpen && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-slate-400 hover:text-white"
              onClick={handleDetectCLIs}
              disabled={isDetectingCLIs}
              aria-label="Detect CLI tools"
            >
              {isDetectingCLIs ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ScanSearch className="h-3 w-3 mr-1" />}
              Detect CLI tools
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-primary hover:text-primary/80"
              onClick={openCreateForm}
            >
              <Plus className="h-3 w-3 mr-1" /> Add Provider
            </Button>
          </div>
        )}
      </div>

      {visibleDetectedCLIEntries.length > 0 && !isFormOpen && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <ScanSearch className="h-3 w-3 text-sky-400" />
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Detected CLI Tools</span>
          </div>
          <div className="space-y-2">
            {visibleDetectedCLIEntries.map(({ detected, addableModels, selectedModel, selectionKey }) => (
              <Card key={`${detected.name}-${detected.cli_command}`} className="bg-black/20 border-white/5 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{detected.name}</span>
                      <ProviderBadge providerType="cli" sourceMode="cli_orchestrated" />
                      {detected.detected_version && (
                        <Badge variant="outline" className="h-4 text-[8px] border-white/10 text-slate-400">
                          {detected.detected_version}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {detected.cli_command} • {selectedModel}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 md:min-w-[320px]">
                    <select
                      aria-label={`Default model for detected CLI ${detected.name}`}
                      value={selectedModel}
                      onChange={(e) => {
                        const nextModel = e.target.value;
                        setSelectedDetectedCLIModels((prev) => ({
                          ...prev,
                          [selectionKey]: nextModel,
                        }));
                      }}
                      className="w-full rounded-md bg-black/30 border border-white/10 text-sm text-slate-200 px-3 py-2 focus:border-primary/50 focus:outline-none"
                    >
                      {addableModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      className="h-9 text-xs shrink-0"
                      onClick={() => handleDetectedCLICreate(detected, selectedModel)}
                      aria-label={`Add detected CLI ${detected.name}`}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!isFormOpen && (
        <Card className="mb-4 border-white/5 bg-black/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs uppercase tracking-widest text-slate-500">
                Feature Defaults
              </h4>
              <p className="mt-1 text-xs text-slate-400">
                Pick the default provider and model used by each AI feature.
              </p>
            </div>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => void handleSaveRoutings()}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Save default routing
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {ROUTING_FEATURES.map((feature) => {
              const draft = routingDrafts[feature.context];
              const modelOptions = getRoutingModelOptions(draft.providerConfigId);
              return (
                <div
                  key={feature.context}
                  className="rounded-lg border border-white/5 bg-black/10 p-3"
                >
                  <div className="mb-3">
                    <div className="text-sm font-medium text-slate-200">
                      {feature.title}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {feature.description}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor={`routing-provider-${feature.context}`}
                        className="text-[10px] uppercase tracking-wider text-slate-500"
                      >
                        Provider for {feature.title}
                      </label>
                      <select
                        id={`routing-provider-${feature.context}`}
                        aria-label={`Provider for ${feature.title}`}
                        value={draft.providerConfigId}
                        onChange={(e) =>
                          handleRoutingProviderChange(feature.context, e.target.value)
                        }
                        className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 focus:border-primary/50 focus:outline-none"
                      >
                        <option value="">No default provider</option>
                        {enabledProviders.map((provider) => (
                          <option key={provider.id} value={String(provider.id)}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`routing-model-${feature.context}`}
                        className="text-[10px] uppercase tracking-wider text-slate-500"
                      >
                        Model for {feature.title}
                      </label>
                      <select
                        id={`routing-model-${feature.context}`}
                        aria-label={`Model for ${feature.title}`}
                        value={draft.model}
                        onChange={(e) =>
                          handleRoutingModelChange(feature.context, e.target.value)
                        }
                        disabled={!draft.providerConfigId}
                        className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {!draft.providerConfigId && (
                          <option value="">Select a provider first</option>
                        )}
                        {draft.providerConfigId && modelOptions.length === 0 && (
                          <option value={draft.model}>
                            {draft.model || 'No model available'}
                          </option>
                        )}
                        {modelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Preset grid */}
      {!isFormOpen && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="h-3 w-3 text-amber-400" />
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Quick Add</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                aria-label={preset.label}
                onClick={() => handlePresetClick(preset)}
                disabled={isLoading}
                className="flex items-center gap-1.5 rounded-md border border-white/5 bg-black/20 px-2.5 py-1.5 text-left text-xs text-slate-300 transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
              >
                <span className="text-sm">{preset.icon}</span>
                <span className="truncate">{preset.label}</span>
                {!preset.needsKey && (
                  <Badge variant="outline" className="ml-auto h-3.5 text-[7px] border-emerald-500/20 text-emerald-400 shrink-0">
                    LOCAL
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Provider list */}
      <div className="space-y-2">
        {providers.length === 0 && !isFormOpen && (
          <div className="text-center py-6 text-slate-500 text-sm">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No AI providers configured</p>
            <p className="text-xs mt-1">Pick a preset above or add a custom provider</p>
          </div>
        )}

        {providers.map((p) => {
          const testResult = testResults[p.id];
          const runtimeHint = getProviderRuntimeHint(
            p,
            testResult?.status as "healthy" | "unhealthy" | "unknown" | null | undefined,
            testResult?.latency
          );
          return (
            <Card key={p.id} className="bg-black/20 border-white/5 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {statusIcon(testResult?.status ?? p.health_status)}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{p.name}</span>
                      <ProviderBadge providerType={p.provider_type} sourceMode={p.provider_type === 'cli' ? 'cli_orchestrated' : 'api'} />
                      {p.has_api_key && (
                        <Badge variant="outline" className="h-4 text-[8px] border-emerald-500/20 text-emerald-400">
                          KEY SET
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {p.default_model}
                      {(p.cli_command || p.base_url) && ` • ${p.cli_command ?? p.base_url}`}
                      {testResult?.latency != null && ` • ${testResult.latency}ms`}
                      {testResult?.error && (
                        <span className="text-red-400"> • {testResult.error}</span>
                      )}
                    </p>
                    {runtimeHint && (
                      <p className="mt-1 text-[10px] text-amber-300">
                        {runtimeHint}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-slate-400 hover:text-white"
                    onClick={() => handleTest(p.id)}
                    disabled={testingId === p.id}
                    aria-label={`Test provider ${p.name}`}
                  >
                    {testingId === p.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <TestTube className="h-3 w-3" />
                    )}
                    <span className="ml-1">Test</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-slate-400 hover:text-white"
                    onClick={() => openEditForm(p)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-red-400/60 hover:text-red-400"
                    onClick={() => deleteProvider(p.id)}
                  >
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
        <Card className="mt-3 bg-black/20 border-white/5 p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">
            {formMode === 'edit' ? 'Edit Provider' : 'New AI Provider'}
          </h4>
          <div className="space-y-3">
            {formMode === 'create' && (
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                  Provider Type
                </label>
                <select
                  value={formType}
                  onChange={(e) => handleTypeChange(e.target.value as ProviderType)}
                  className="w-full mt-1 rounded-md bg-black/30 border border-white/10 text-sm text-slate-200 px-3 py-2 focus:border-primary/50 focus:outline-none"
                >
                  {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            <Input
              placeholder="Provider name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />

            {showUrlField(formType) && (
              <Input
                placeholder="Base URL"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
              />
            )}

            {showKeyField(formType) && (
              <Input
                type="password"
                placeholder={formMode === 'edit' ? 'API Key (leave empty to keep current)' : 'API Key'}
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
              />
            )}

            <Input
              placeholder="Default model"
              value={formModel}
              onChange={(e) => setFormModel(e.target.value)}
            />

            {formType === 'cli' && (
              <>
                <Input
                  placeholder="CLI command"
                  value={formCLICommand}
                  onChange={(e) => {
                    const nextCommand = e.target.value;
                    setFormCLICommand(nextCommand);
                    if (!nextCommand.trim() || (resolvedCLI && nextCommand.trim() !== resolvedCLI.cli_command)) {
                      setResolvedCLI(null);
                    }
                  }}
                  onBlur={() => {
                    void resolveCLIProvider();
                  }}
                />
                {isResolvingCLI && (
                  <p className="text-[10px] text-slate-500">
                    Detecting CLI profile...
                  </p>
                )}
                {!isResolvingCLI && resolvedCLI && (
                  <p className="text-[10px] text-slate-500">
                    Detected {resolvedCLI.name}
                    {resolvedCLIModels.length
                      ? ` • ${resolvedCLIModels.join(', ')}`
                      : ''}
                  </p>
                )}
                {resolvedCLIModels.length > 0 && (
                  <div>
                    <label
                      htmlFor="detected-cli-models"
                      className="text-[10px] text-slate-500 uppercase tracking-wider"
                    >
                      Detected CLI Models
                    </label>
                    <select
                      id="detected-cli-models"
                      aria-label="Detected CLI models"
                      value={resolvedCLIModelSelection}
                      onChange={(e) => setFormModel(e.target.value)}
                      className="w-full mt-1 rounded-md bg-black/30 border border-white/10 text-sm text-slate-200 px-3 py-2 focus:border-primary/50 focus:outline-none"
                    >
                      {!resolvedCLIModelSelection && (
                        <option value="" disabled>
                          {formModel.trim() ? 'Keep typed custom model' : 'Choose detected model'}
                        </option>
                      )}
                      {resolvedCLIModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Newest detected model is selected by default.
                    </p>
                  </div>
                )}
                <Input
                  placeholder="CLI args template"
                  value={formCLIArgsTemplate}
                  onChange={(e) => setFormCLIArgsTemplate(e.target.value)}
                />
                <Input
                  placeholder="Interactive args template"
                  value={formCLIInteractiveArgs}
                  onChange={(e) => setFormCLIInteractiveArgs(e.target.value)}
                />
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                    Parse Mode
                  </label>
                  <select
                    value={formParseMode}
                    onChange={(e) => setFormParseMode(e.target.value as CLIParseMode)}
                    className="w-full mt-1 rounded-md bg-black/30 border border-white/10 text-sm text-slate-200 px-3 py-2 focus:border-primary/50 focus:outline-none"
                  >
                    <option value="json">json</option>
                    <option value="markdown">markdown</option>
                    <option value="raw">raw</option>
                  </select>
                </div>
              </>
            )}

            {/* Advanced settings */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              Advanced
            </button>

            {showAdvanced && (
              <div className="space-y-3 rounded-md border border-white/5 bg-black/10 p-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Temperature
                    </label>
                    <span className="text-xs text-slate-400 tabular-nums">{formTemp.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={formTemp}
                    onChange={(e) => setFormTemp(parseFloat(e.target.value))}
                    className="w-full accent-primary h-1.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                    Max Tokens
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={128000}
                    value={formMaxTokens}
                    onChange={(e) => setFormMaxTokens(parseInt(e.target.value) || 4096)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                    Timeout (seconds)
                  </label>
                  <Input
                    type="number"
                    min={5}
                    max={300}
                    value={formTimeout}
                    onChange={(e) => setFormTimeout(parseInt(e.target.value) || 30)}
                    className="mt-1"
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={resetForm} className="text-slate-400">
                Cancel
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={isLoading || isResolvingCLI}>
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                {formMode === 'edit' ? 'Save Changes' : 'Add Provider'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
