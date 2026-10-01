import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { AppLayout } from "../components/Layout/AppLayout";
import { createQueryClient } from "@/lib/queryClient";

const mockAuthStoreState = vi.hoisted(() => ({
  user: {
    username: "pilot",
    is_super_admin: true,
  },
  logout: vi.fn(),
}));

const mockProjectStoreState = vi.hoisted(() => ({
  currentProject: null as
    | null
    | {
        id: string;
        name: string;
        variables: Record<string, string>;
      },
}));

const reportApiMocks = vi.hoisted(() => ({
  reportQueryKeys: {
    detail: (projectId: string) => ["report", projectId] as const,
    proposals: (projectId: string) => ["report", projectId, "proposals"] as const,
  },
  fetchReportProposals: vi.fn(),
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => mockAuthStoreState,
}));

vi.mock("../stores/projectStore", () => ({
  useProjectStore: (selector?: (state: typeof mockProjectStoreState) => unknown) => {
    if (typeof selector === "function") {
      return selector(mockProjectStoreState);
    }
    return mockProjectStoreState;
  },
}));

vi.mock("@/api/report", () => reportApiMocks);

function renderLayout(initialEntries: string[] = ["/"]) {
  const queryClient = createQueryClient();
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <AppLayout>
          <div>content</div>
        </AppLayout>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

describe("AppLayout", () => {
  beforeEach(() => {
    mockProjectStoreState.currentProject = null;
    mockAuthStoreState.user = {
      username: "pilot",
      is_super_admin: true,
    };
    reportApiMocks.fetchReportProposals.mockReset();
    reportApiMocks.fetchReportProposals.mockResolvedValue({ items: [], total: 0 });
  });

  it("renders global search in the header", () => {
    renderLayout();

    expect(screen.getByPlaceholderText(/Search/i)).toBeInTheDocument();
  });

  it("renders nav links and marks the active route", () => {
    renderLayout(["/commands"]);

    expect(screen.getByRole("link", { name: /Dashboard/i })).toBeInTheDocument();
    const commandsLink = screen.getByRole("link", {
      name: /Command Library/i,
    });
    expect(commandsLink).toHaveAttribute("aria-current", "page");
  });

  it("renders nav links inside the main header row", () => {
    renderLayout(["/commands"]);

    const headerMain = screen.getByTestId("header-main");
    expect(
      within(headerMain).getByRole("link", { name: /Command Library/i })
    ).toBeInTheDocument();
  });

  it("toggles mobile nav menu", () => {
    renderLayout(["/"]);

    const toggle = screen.getByRole("button", { name: /Open navigation/i });
    fireEvent.click(toggle);
    const mobileNav = screen.getByTestId("mobile-nav");
    expect(mobileNav).toBeInTheDocument();
    expect(
      within(mobileNav).getByRole("button", { name: /Notifications/i })
    ).toBeInTheDocument();
    expect(
      within(mobileNav).getByRole("button", { name: /Open profile menu/i })
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("mobile-nav")).not.toBeInTheDocument();
  });

  it("hides internal serialized variables from project chips", () => {
    mockProjectStoreState.currentProject = {
      id: "p1",
      name: "ENGAGEMENT UI T006",
      variables: {
        target_ip: "192.168.1.84",
        engagementstatev1: JSON.stringify({
          version: "v1",
          sections: [{ id: "recon", items: Array.from({ length: 20 }, (_, i) => i) }],
        }),
      },
    };

    renderLayout(["/projects/p1"]);

    expect(screen.getByText("192.168.1.84")).toBeInTheDocument();
    expect(screen.queryByText(/\$engagementstatev1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/"version":"v1"/i)).not.toBeInTheDocument();
  });

  it("hides the global settings entry for non-super-admin users", () => {
    mockAuthStoreState.user = {
      username: "pilot",
      is_super_admin: false,
    };

    renderLayout(["/"]);

    fireEvent.click(screen.getAllByRole("button", { name: /Open profile menu/i })[0]);

    expect(screen.queryByRole("menuitem", { name: /^Settings$/i })).not.toBeInTheDocument();
  });

  it("shows a badge on the Reports nav item when pending updates exist", async () => {
    mockProjectStoreState.currentProject = {
      id: "p1",
      name: "Cap",
      variables: {},
    };
    reportApiMocks.fetchReportProposals.mockResolvedValue({ items: [{ id: "proposal-1" }], total: 1 });

    renderLayout(["/projects/p1"]);

    expect(await screen.findByTestId("reports-nav-badge")).toHaveTextContent("1");
  });

  it("drops the Reports badge after proposal data refreshes to zero pending updates", async () => {
    mockProjectStoreState.currentProject = {
      id: "p1",
      name: "Cap",
      variables: {},
    };
    reportApiMocks.fetchReportProposals
      .mockResolvedValueOnce({ items: [{ id: "proposal-1" }], total: 1 })
      .mockResolvedValueOnce({ items: [], total: 0 });

    const { queryClient } = renderLayout(["/projects/p1"]);

    expect(await screen.findByTestId("reports-nav-badge")).toHaveTextContent("1");

    await queryClient.invalidateQueries({
      queryKey: reportApiMocks.reportQueryKeys.proposals("p1"),
    });

    await waitFor(() =>
      expect(screen.queryByTestId("reports-nav-badge")).not.toBeInTheDocument(),
    );
    expect(reportApiMocks.fetchReportProposals).toHaveBeenCalledTimes(2);
  });
});
