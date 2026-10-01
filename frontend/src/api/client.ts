/// <reference types="vite/client" />
import axios, { AxiosHeaders, type AxiosError, type InternalAxiosRequestConfig } from "axios";

import {
  buildApiDiagnosticsEvent,
  shouldRecordApiDiagnosticsEvent,
} from "@/lib/diagnostics";
import { useDiagnosticsStore } from "@/stores/diagnosticsStore";

const API_VERSION = "v1";
const ACCESS_TOKEN_STORAGE_KEY = "pwnpilot_access_token";
const LOCAL_DEV_PORTS = [8000, 8001, 8002, 8003] as const;
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"] as const;
const API_DISCOVERY_TIMEOUT_MS = 1500;
const API_REQUEST_TIMEOUT_MS = 8000;

const configuredApiBase = import.meta.env.VITE_API_URL?.trim() || null;

export let API_BASE_URL = configuredApiBase || "http://localhost:8000";

interface HealthResponse {
  app?: string;
  status?: string;
  version?: string;
}

interface HostnameLike {
  hostname: string;
}

export const isHealthyPwnPilotResponse = (
  value: unknown
): value is HealthResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as HealthResponse;
  return candidate.app === "PwnPilot" && candidate.status === "healthy";
};

const isLocalHostname = (hostname: string) =>
  LOCAL_HOSTNAMES.includes(hostname as (typeof LOCAL_HOSTNAMES)[number]);

export const alignLocalApiBaseToCurrentHostname = (
  base: string,
  currentLocation: HostnameLike
): string => {
  try {
    const parsed = new URL(base);
    if (
      !isLocalHostname(parsed.hostname) ||
      !isLocalHostname(currentLocation.hostname) ||
      parsed.hostname === currentLocation.hostname
    ) {
      return base;
    }

    parsed.hostname = currentLocation.hostname;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return base;
  }
};

export const buildLocalApiBaseCandidates = ({
  hostname,
}: HostnameLike): string[] => {
  const prioritizedHosts = isLocalHostname(hostname)
    ? [hostname, ...LOCAL_HOSTNAMES.filter((candidate) => candidate !== hostname)]
    : LOCAL_HOSTNAMES;

  return prioritizedHosts.flatMap((host) =>
    LOCAL_DEV_PORTS.map((port) => `http://${host}:${port}`)
  );
};

export const selectHealthyApiBase = async (
  candidates: string[],
  probe: (base: string) => Promise<unknown>,
  timeoutMs = API_DISCOVERY_TIMEOUT_MS
): Promise<string | null> => {
  for (const candidate of candidates) {
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

    try {
      const response = await Promise.race<unknown>([
        probe(candidate),
        new Promise((_, reject) => {
          timeoutId = globalThis.setTimeout(() => {
            reject(new Error(`API discovery timed out for ${candidate}`));
          }, timeoutMs);
        }),
      ]);

      if (isHealthyPwnPilotResponse(response)) {
        return candidate;
      }
    } catch {
      // Keep probing local dev candidates.
    } finally {
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    }
  }

  return null;
};

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api/${API_VERSION}`,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: API_REQUEST_TIMEOUT_MS,
});

let accessToken: string | null = null;
let apiBaseResolutionPromise: Promise<string> | null = null;

const readStoredToken = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStoredToken = (token: string | null) => {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc.)
  }
};

const probeApiBase = async (base: string): Promise<unknown> => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, API_DISCOVERY_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${base}/health`, {
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Health probe failed for ${base}`);
  }

  return response.json();
};

export const resolveApiBaseUrl = async (): Promise<string> => {
  if (configuredApiBase) {
    if (typeof window !== "undefined") {
      API_BASE_URL = alignLocalApiBaseToCurrentHostname(
        configuredApiBase,
        window.location
      );
      return API_BASE_URL;
    }

    API_BASE_URL = configuredApiBase;
    return configuredApiBase;
  }

  if (typeof window === "undefined" || !isLocalHostname(window.location.hostname)) {
    return API_BASE_URL;
  }

  if (!apiBaseResolutionPromise) {
    apiBaseResolutionPromise = (async () => {
      const discoveredBase = await selectHealthyApiBase(
        buildLocalApiBaseCandidates(window.location),
        probeApiBase
      );

      if (discoveredBase) {
        API_BASE_URL = discoveredBase;
      }

      return API_BASE_URL;
    })();
  }

  return apiBaseResolutionPromise;
};

const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

export const buildApiUrl = (path: string) => `${API_BASE_URL}${normalizePath(path)}`;

export const buildWebSocketUrl = (path: string) =>
  `${API_BASE_URL.replace(/^http/, "ws")}${normalizePath(path)}`;

export const getAccessToken = () => accessToken ?? readStoredToken();

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  writeStoredToken(token);
};

api.interceptors.request.use(async (config) => {
  const apiBase = await resolveApiBaseUrl();
  config.baseURL = `${apiBase}/api/${API_VERSION}`;
  config.withCredentials = true;
  const token = getAccessToken();
  if (token) {
    const headers = AxiosHeaders.from(config.headers);
    headers.set("Authorization", `Bearer ${token}`);
    config.headers = headers;
  }
  return config;
});

// Auth recovery: on 401 try a refresh once, then retry the original request.
// On failure, clear the session and redirect to /login (without bouncing
// the auth endpoints themselves to avoid loops).
type RetryableConfig = InternalAxiosRequestConfig & { _authRetry?: boolean };

const AUTH_PATHS = ["/auth/login", "/auth/signup", "/auth/refresh", "/auth/logout"];

const isAuthEndpoint = (url?: string) =>
  !!url && AUTH_PATHS.some((path) => url.includes(path));

let refreshPromise: Promise<string | null> | null = null;

const refreshAccessToken = async (): Promise<string | null> => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await api.post<{ access_token: string }>(
          "/auth/refresh",
          {},
          { _authRetry: true } as RetryableConfig,
        );
        const token = response.data.access_token;
        setAccessToken(token);
        return token;
      } catch {
        setAccessToken(null);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
};

const redirectToLogin = () => {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  const next = encodeURIComponent(
    window.location.pathname + window.location.search,
  );
  window.location.href = `/login?next=${next}`;
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const status = error.response?.status;

    if (status === 401 && config && !config._authRetry && !isAuthEndpoint(config.url)) {
      config._authRetry = true;
      const token = await refreshAccessToken();
      if (token) {
        const headers = AxiosHeaders.from(config.headers);
        headers.set("Authorization", `Bearer ${token}`);
        config.headers = headers;
        return api.request(config);
      }
      redirectToLogin();
    }

    if (
      import.meta.env.DEV &&
      shouldRecordApiDiagnosticsEvent(error)
    ) {
      useDiagnosticsStore.getState().recordEvent(buildApiDiagnosticsEvent(error));
    }

    return Promise.reject(error);
  },
);
