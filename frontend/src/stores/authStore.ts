import { create } from "zustand";

import { api, getAccessToken, setAccessToken } from "../api/client";
import type { UserProfile } from "../types";

const AUTH_SESSION_STORAGE_KEY = "pwnpilot_auth_session";
const AUTH_REQUEST_TIMEOUT_MS = 8000;

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  isLoading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  signup: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
}

const getAuthErrorMessage = (error: unknown, fallback: string): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "error" in error.response.data &&
    typeof error.response.data.error === "object" &&
    error.response.data.error !== null &&
    "message" in error.response.data.error &&
    typeof error.response.data.error.message === "string"
  ) {
    return error.response.data.error.message;
  }

  if (error instanceof Error && /(network|timeout|timed out|abort)/i.test(error.message)) {
    return "Unable to reach the PwnPilot API";
  }

  return fallback;
};

const getAuthErrorCode = (error: unknown): string | null => {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "error" in error.response.data &&
    typeof error.response.data.error === "object" &&
    error.response.data.error !== null &&
    "code" in error.response.data.error &&
    typeof error.response.data.error.code === "string"
  ) {
    return error.response.data.error.code;
  }

  return null;
};

const isAuthStatusError = (error: unknown): boolean => {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    typeof error.response.status === "number"
  ) {
    return error.response.status === 401 || error.response.status === 403;
  }

  return false;
};

const shouldClearPersistedSession = (error: unknown): boolean =>
  isAuthStatusError(error) || getAuthErrorCode(error) === "8005:AUTH_REFRESH_REVOKED";

const withAuthRequestTimeout = async <T>(promise: Promise<T>): Promise<T> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
          reject(new Error("PwnPilot API timeout"));
        }, AUTH_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
};

const hasPersistedSession = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const setPersistedSession = (active: boolean) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (active) {
      window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures during auth bootstrap.
  }
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isLoading: false,
  error: null,

  initialize: async () => {
    if (initializePromise) {
      return initializePromise;
    }

    set({ isLoading: true, error: null });

    initializePromise = (async () => {
      const cachedToken = getAccessToken();
      const shouldAttemptRefresh = Boolean(cachedToken) || hasPersistedSession();

      if (cachedToken) {
        setAccessToken(cachedToken);
        set({ accessToken: cachedToken });

        try {
          const me = await withAuthRequestTimeout(api.get<UserProfile>("/auth/me"));
          setPersistedSession(true);
          set({ user: me.data, accessToken: cachedToken, isLoading: false });
          return;
        } catch {
          setAccessToken(null);
          set({ accessToken: null });
        }
      }

      if (!shouldAttemptRefresh) {
        setPersistedSession(false);
        set({ user: null, accessToken: null, isLoading: false });
        return;
      }

      try {
        const refresh = await withAuthRequestTimeout(api.post("/auth/refresh"));
        const token = refresh.data.access_token as string;
        setAccessToken(token);
        set({ accessToken: token });
        const me = await withAuthRequestTimeout(api.get<UserProfile>("/auth/me"));
        setPersistedSession(true);
        set({ user: me.data, accessToken: token, isLoading: false });
      } catch (error) {
        setAccessToken(null);
        setPersistedSession(!shouldClearPersistedSession(error));
        set({
          user: null,
          accessToken: null,
          error: getAuthErrorMessage(error, "Unable to restore the saved session"),
          isLoading: false,
        });
      }
    })().finally(() => {
      initializePromise = null;
    });

    return initializePromise;
  },

  login: async (usernameOrEmail, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await withAuthRequestTimeout(api.post("/auth/login", {
        username_or_email: usernameOrEmail,
        password,
      }));
      const token = response.data.access_token as string;
      setAccessToken(token);
      set({ accessToken: token });
      const me = await withAuthRequestTimeout(api.get<UserProfile>("/auth/me"));
      setPersistedSession(true);
      set({ user: me.data, accessToken: token, isLoading: false });
    } catch (error) {
      setAccessToken(null);
      set({
        user: null,
        accessToken: null,
        error: getAuthErrorMessage(error, "Login failed"),
        isLoading: false,
      });
    }
  },

  signup: async (username, email, password) => {
    set({ isLoading: true, error: null });
    try {
      const trimmedEmail = email.trim();
      await withAuthRequestTimeout(api.post("/auth/signup", {
        username,
        password,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
      }));
      await useAuthStore.getState().login(username, password);
    } catch (error) {
      set({
        error: getAuthErrorMessage(error, "Signup failed"),
        isLoading: false,
      });
    }
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Local logout should still succeed even if the backend is unreachable.
    } finally {
      setAccessToken(null);
      setPersistedSession(false);
      set({ user: null, accessToken: null, error: null });
    }
  },

  updateProfile: async (updates) => {
    const response = await api.put<UserProfile>("/auth/me", updates);
    set({ user: response.data });
  },
}));

let initializePromise: Promise<void> | null = null;
