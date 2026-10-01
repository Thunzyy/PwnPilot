import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiGetMock,
  apiPostMock,
  setAccessTokenMock,
  getAccessTokenMock,
} = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  setAccessTokenMock: vi.fn((token: string | null) => {
    if (token) {
      window.localStorage.setItem("pwnpilot_access_token", token);
    } else {
      window.localStorage.removeItem("pwnpilot_access_token");
    }
  }),
  getAccessTokenMock: vi.fn(() =>
    window.localStorage.getItem("pwnpilot_access_token"),
  ),
}));

vi.mock("../api/client", () => ({
  api: {
    get: apiGetMock,
    post: apiPostMock,
  },
  setAccessToken: setAccessTokenMock,
  getAccessToken: getAccessTokenMock,
}));

import { useAuthStore } from "../stores/authStore";

const ACCESS_TOKEN_STORAGE_KEY = "pwnpilot_access_token";
const AUTH_SESSION_STORAGE_KEY = "pwnpilot_auth_session";
const mockUser = {
  id: "user-1",
  username: "operator",
  email: "operator@example.com",
  is_super_admin: true,
};

describe("authStore", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isLoading: false,
      error: null,
    });
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    setAccessTokenMock.mockReset();
    getAccessTokenMock.mockClear();
    window.localStorage.clear();
  });

  it("starts unauthenticated", () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
  });

  it("uses a cached access token before attempting refresh", async () => {
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, "cached-token");
    apiGetMock.mockResolvedValueOnce({ data: mockUser });

    await useAuthStore.getState().initialize();

    expect(apiGetMock).toHaveBeenCalledWith("/auth/me");
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().accessToken).toBe("cached-token");
    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBe("1");
  });

  it("falls back to refresh when the cached token is rejected", async () => {
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, "expired-token");
    apiGetMock
      .mockRejectedValueOnce(new Error("expired"))
      .mockResolvedValueOnce({ data: mockUser });
    apiPostMock.mockResolvedValueOnce({
      data: { access_token: "fresh-token" },
    });

    await useAuthStore.getState().initialize();

    expect(apiGetMock).toHaveBeenNthCalledWith(1, "/auth/me");
    expect(apiPostMock).toHaveBeenCalledWith("/auth/refresh");
    expect(apiGetMock).toHaveBeenNthCalledWith(2, "/auth/me");
    expect(setAccessTokenMock).toHaveBeenCalledWith("fresh-token");
    expect(useAuthStore.getState().accessToken).toBe("fresh-token");
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBe("1");
  });

  it("does not refresh when there is no cached token and no persisted session", async () => {
    await useAuthStore.getState().initialize();

    expect(apiPostMock).not.toHaveBeenCalled();
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("refreshes when a persisted session marker exists without a cached token", async () => {
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
    apiPostMock.mockResolvedValueOnce({
      data: { access_token: "fresh-token" },
    });
    apiGetMock.mockResolvedValueOnce({ data: mockUser });

    await useAuthStore.getState().initialize();

    expect(apiPostMock).toHaveBeenCalledWith("/auth/refresh");
    expect(apiGetMock).toHaveBeenCalledWith("/auth/me");
    expect(useAuthStore.getState().accessToken).toBe("fresh-token");
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBe("1");
  });

  it("clears the persisted session marker when refresh bootstrap is explicitly revoked", async () => {
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
    apiPostMock.mockRejectedValueOnce({
      response: {
        status: 401,
        data: {
          error: {
            code: "8005:AUTH_REFRESH_REVOKED",
            message: "Refresh token missing",
          },
        },
      },
    });

    await useAuthStore.getState().initialize();

    expect(apiPostMock).toHaveBeenCalledWith("/auth/refresh");
    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("deduplicates concurrent initialize calls", async () => {
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, "cached-token");

    let resolveProfile: ((value: { data: typeof mockUser }) => void) | undefined;
    apiGetMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve;
        }),
    );

    const first = useAuthStore.getState().initialize();
    const second = useAuthStore.getState().initialize();

    expect(apiGetMock).toHaveBeenCalledTimes(1);

    resolveProfile?.({ data: mockUser });
    await Promise.all([first, second]);

    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("clears local auth state even if logout fails remotely", async () => {
    useAuthStore.setState({
      user: mockUser,
      accessToken: "cached-token",
      isLoading: false,
      error: null,
    });
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, "cached-token");
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
    apiPostMock.mockRejectedValueOnce(new Error("network"));

    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();

    expect(setAccessTokenMock).toHaveBeenCalledWith(null);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
  });
});
