import type { AIProvider } from "@/types/ai";

const LOCAL_HOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i;
const SLOW_PROVIDER_LATENCY_MS = 1500;

export const isLocalOpenAICompatProvider = (provider: AIProvider) =>
  provider.provider_type === "openai_compat" &&
  Boolean(provider.base_url && LOCAL_HOST_PATTERN.test(provider.base_url));

export const getProviderRuntimeHint = (
  provider: AIProvider,
  statusOverride?: "healthy" | "unhealthy" | "unknown" | null,
  latencyMs?: number | null
) => {
  const effectiveStatus = statusOverride ?? provider.health_status;

  if (
    effectiveStatus === "healthy" &&
    latencyMs != null &&
    latencyMs >= SLOW_PROVIDER_LATENCY_MS
  ) {
    return `Provider reachable but slow (${latencyMs} ms). Expect a slower first response.`;
  }

  if (provider.provider_type === "ollama") {
    if (effectiveStatus === "unhealthy") {
      return `Ensure Ollama is running at ${provider.base_url ?? "http://localhost:11434"} and pull ${provider.default_model}.`;
    }
    return `Local runtime. Pull ${provider.default_model} in Ollama before first use.`;
  }

  if (provider.provider_type === "cli") {
    if (effectiveStatus === "unhealthy") {
      return `CLI unavailable. Ensure ${provider.cli_command ?? provider.name} is installed and authenticated, then re-test it.`;
    }
    return `Subscription CLI runtime. Run ${provider.cli_command ?? provider.name} auth/setup before first use.`;
  }

  if (isLocalOpenAICompatProvider(provider)) {
    return "Local OpenAI-compatible runtime. Start the server and expose /models before first use.";
  }

  if (!provider.has_api_key) {
    return "API key missing. Add credentials before relying on this provider.";
  }

  if (effectiveStatus === "unhealthy") {
    return "Last health check failed. Re-test after fixing connectivity or credentials.";
  }

  return null;
};

export const getProviderAttentionMessage = (provider: AIProvider) => {
  if (provider.provider_type === "ollama") {
    return `Ollama is enabled but not yet healthy. Verify the local runtime and model ${provider.default_model}.`;
  }

  if (isLocalOpenAICompatProvider(provider)) {
    return "A local OpenAI-compatible runtime is enabled but not yet healthy. Start the local server and re-test it.";
  }

  if (provider.provider_type === "cli") {
    return `${provider.name} needs a successful CLI probe before chat can rely on it.`;
  }

  return `${provider.name} needs a healthy provider check before starting a chat.`;
};

export const getModelSelectorEmptyMessage = ({
  provider,
  hasCachedModels,
  errorMessage,
}: {
  provider: AIProvider;
  hasCachedModels: boolean;
  errorMessage?: string | null;
}) => {
  if (errorMessage) {
    return errorMessage;
  }

  if (!hasCachedModels) {
    return "Loading models…";
  }

  if (provider.provider_type === "ollama") {
    return `No models discovered. Start Ollama and pull ${provider.default_model}.`;
  }

  if (provider.provider_type === "cli") {
    return "No models discovered. Re-run CLI detection or configure the CLI provider manually.";
  }

  if (isLocalOpenAICompatProvider(provider)) {
    return "No models discovered. Start the local OpenAI-compatible server and expose /models.";
  }

  if (!provider.has_api_key) {
    return "No models returned. Add an API key or validate the base URL.";
  }

  if (provider.health_status === "healthy") {
    return "Provider responded but returned no models. Check model access or local runtime state.";
  }

  if (provider.health_status === "unhealthy") {
    return "Provider unavailable. Re-test it in AI Settings before retrying.";
  }

  return "No models returned yet. Re-test the provider in AI Settings.";
};
