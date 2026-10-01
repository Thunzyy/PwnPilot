import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";

const { authState, initializeMock } = vi.hoisted(() => ({
  authState: {
    user: {
      id: "user-1",
      username: "operator",
      email: "operator@example.com",
      is_super_admin: true,
    },
    isLoading: false,
  },
  initializeMock: vi.fn(),
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    user: authState.user,
    initialize: initializeMock,
    isLoading: authState.isLoading,
    logout: vi.fn(),
    updateProfile: vi.fn(),
  }),
}));

vi.mock("../pages/Dashboard", () => ({
  Dashboard: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock("../pages/ProjectView", () => ({
  ProjectView: () => <div>Project View</div>,
}));

vi.mock("../pages/Settings", () => ({
  SettingsPage: () => <div data-testid="settings-page">Settings</div>,
}));
import App from "../App";

async function renderApp(initialEntries = ["/"]) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByTestId("dashboard-page");
}

describe("App", () => {
  beforeEach(() => {
    authState.user = {
      id: "user-1",
      username: "operator",
      email: "operator@example.com",
      is_super_admin: true,
    };
    authState.isLoading = false;
    vi.clearAllMocks();
  });

  it("calls auth initialization on mount", async () => {
    await renderApp();

    expect(initializeMock).toHaveBeenCalledTimes(1);
  });

  it("renders PwnPilot title", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderApp();
    expect(screen.getByText(/PwnPilot/i)).toBeInTheDocument();

    const loggedOutput = consoleErrorSpy.mock.calls.flat().map(String).join("\n");
    expect(loggedOutput).not.toContain("HTMLCanvasElement.prototype.getContext");
  });

  it("shows a visible bootstrap loading state while auth initializes", () => {
    authState.user = null;
    authState.isLoading = true;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByTestId("app-bootstrap-loading")).toBeInTheDocument();
    expect(screen.getByText(/connecting to pwnpilot api/i)).toBeInTheDocument();
  });

  it("redirects non-super-admin users away from global settings", async () => {
    authState.user = {
      id: "user-2",
      username: "member",
      email: "member@example.com",
      is_super_admin: false,
    };

    await renderApp(["/settings"]);

    expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-page")).not.toBeInTheDocument();
  });
});
