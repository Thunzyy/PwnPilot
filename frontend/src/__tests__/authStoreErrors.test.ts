import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiGetMock,
  apiPostMock,
  setAccessTokenMock,
  getAccessTokenMock,
} = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  setAccessTokenMock: vi.fn(),
  getAccessTokenMock: vi.fn(() => null),
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

const AUTH_SESSION_STORAGE_KEY = "pwnpilot_auth_session";

describe("authStore error handling", () => {
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
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces backend validation errors during signup", async () => {
    apiPostMock.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            message: "Username already taken",
          },
        },
      },
    });

    await useAuthStore.getState().signup("admin", "admin@gmail.com", "admin");

    expect(useAuthStore.getState().error).toBe("Username already taken");
  });

  it("surfaces backend reachability errors during login", async () => {
    apiPostMock.mockRejectedValueOnce(new Error("Network Error"));

    await useAuthStore.getState().login("admin", "admin");

    expect(useAuthStore.getState().error).toBe(
      "Unable to reach the PwnPilot API"
    );
  });

  it("clears bootstrap loading when restoring a saved session times out", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
    apiPostMock.mockImplementation(
      () => new Promise(() => undefined),
    );

    const initializePromise = useAuthStore.getState().initialize();

    await vi.advanceTimersByTimeAsync(8000);
    await initializePromise;

    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().error).toBe("Unable to reach the PwnPilot API");
    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBe("1");
  });
});
