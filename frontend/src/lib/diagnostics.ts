export type DiagnosticsCategory =
  | "api"
  | "websocket"
  | "ai"
  | "vpn"
  | "terminal";

export type DiagnosticsSeverity = "info" | "warning" | "error";

export interface DiagnosticsEventInput {
  category: DiagnosticsCategory;
  severity: DiagnosticsSeverity;
  title: string;
  message: string;
  source?: string;
  method?: string;
  status?: number;
  code?: string;
  metadata?: Record<string, unknown>;
}

interface AxiosLikeError {
  code?: string;
  message?: string;
  config?: {
    url?: string;
    method?: string;
    baseURL?: string;
  };
  response?: {
    status?: number;
    data?: unknown;
  };
}

const CATEGORY_LABELS: Record<DiagnosticsCategory, string> = {
  api: "API",
  websocket: "WebSocket",
  ai: "AI",
  vpn: "VPN",
  terminal: "Terminal",
};

const TOKEN_QUERY_PARAM = /([?&](?:token|access_token|authorization)=)[^&]+/gi;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isDevDiagnosticsEnabled = (isDev = import.meta.env.DEV) => isDev;

export const redactDiagnosticsUrl = (url?: string) =>
  url?.replace(TOKEN_QUERY_PARAM, "$1[redacted]");

export const classifyDiagnosticsUrl = (
  url?: string | null
): DiagnosticsCategory => {
  const normalized = (url ?? "").toLowerCase();

  if (normalized.includes("/terminal") || normalized.includes("ttyd")) {
    return "terminal";
  }
  if (normalized.includes("/vpn") || normalized.includes("vpn-")) {
    return "vpn";
  }
  if (
    normalized.includes("/ai") ||
    normalized.includes("/ws/ai") ||
    normalized.includes("/agents")
  ) {
    return "ai";
  }
  if (normalized.startsWith("ws://") || normalized.startsWith("wss://")) {
    return "websocket";
  }
  return "api";
};

const extractApiErrorMessage = (data: unknown, fallback: string) => {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (!isRecord(data)) {
    return fallback;
  }

  if (typeof data.detail === "string" && data.detail.trim()) {
    return data.detail;
  }

  if (typeof data.message === "string" && data.message.trim()) {
    return data.message;
  }

  if (isRecord(data.error)) {
    if (typeof data.error.message === "string" && data.error.message.trim()) {
      return data.error.message;
    }
    if (typeof data.error.code === "string" && data.error.code.trim()) {
      return data.error.code;
    }
  }

  return fallback;
};

export const shouldRecordApiDiagnosticsEvent = (error: AxiosLikeError) =>
  error.code !== "ERR_CANCELED" && error.message !== "canceled";

export const buildApiDiagnosticsEvent = (
  error: AxiosLikeError
): DiagnosticsEventInput => {
  const url = redactDiagnosticsUrl(error.config?.url) ?? "unknown endpoint";
  const category = classifyDiagnosticsUrl(url);
  const status = error.response?.status;
  const method = error.config?.method?.toUpperCase();
  const fallback =
    error.message || (status ? `Request failed with status ${status}` : "Request failed");
  const message = extractApiErrorMessage(error.response?.data, fallback);
  const severity: DiagnosticsSeverity =
    status === undefined || status >= 500 ? "error" : "warning";

  return {
    category,
    severity,
    title: `${CATEGORY_LABELS[category]} API request failed`,
    message,
    source: url,
    method,
    status,
    code: error.code,
  };
};

export const getDiagnosticsCategoryLabel = (category: DiagnosticsCategory) =>
  CATEGORY_LABELS[category];
