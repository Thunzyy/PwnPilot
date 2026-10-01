import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";

const { fetchSettingsApiMock, settingsQueryKeys, updateSettingsMock } = vi.hoisted(
  () => ({
    fetchSettingsApiMock: vi.fn(async () => ({
      workspace_base_path: "PwnPilot/project",
      vault_path: "",
      vpn_path: "",
      vpn_content: "",
      report_evaluation_lease_seconds: 30,
      report_evaluation_heartbeat_interval_seconds: 10,
      report_evaluation_reclaim_poll_interval_seconds: 15,
      report_evaluation_max_runtime_seconds: 300,
      vpn_platform_defaults: {
        htb: {
          label: "Hack The Box",
          config_path: "/vpn/htb.ovpn",
          connect_command: "sudo openvpn {{vpn_path}}",
          has_api_token: true,
        },
        academy: {
          label: "HTB Academy",
          config_path: "/vpn/academy.ovpn",
          connect_command: "sudo openvpn {{vpn_path}}",
          file_name: "academy.ovpn",
          managed: true,
        },
      },
    })),
    settingsQueryKeys: {
      current: ["settings"],
    },
    updateSettingsMock: vi.fn(),
  })
);

vi.mock("../stores/authStore", () => {
  const storeState = {
    user: {
      id: "user-1",
      username: "operator",
      email: "operator@example.com",
      display_name: "Operator",
      team: "Red",
      timezone: "Europe/Paris",
      signature: "sig",
      is_super_admin: true,
    },
    updateProfile: vi.fn(),
  };
  return {
    useAuthStore: (selector?: (s: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState,
  };
});

vi.mock("../stores/settingsStore", () => {
  const storeState = {
    settings: null as Record<string, string> | null,
    error: null as string | null,
    setSettings: vi.fn(),
    fetchSettings: vi.fn(() => {
      throw new Error("OperatorSettings should use React Query for settings bootstrap");
    }),
    updateSettings: updateSettingsMock,
    isLoading: false,
  };
  return {
    DEFAULT_WORKSPACE_BASE: "PwnPilot/project",
    useSettingsStore: (selector?: (s: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState,
  };
});

vi.mock("@/api/settings", () => ({
  fetchSettings: fetchSettingsApiMock,
  settingsQueryKeys,
}));

vi.mock("../components/Settings/SystemPromptSelector", () => ({
  SystemPromptSelector: ({ scope }: { scope: string }) => (
    <div data-testid="system-prompt-selector">{scope}-system-prompt</div>
  ),
}));

import { OperatorSettings } from "../components/Settings/OperatorSettings";

describe("OperatorSettings", () => {
  beforeEach(() => {
    updateSettingsMock.mockReset();
    updateSettingsMock.mockResolvedValue(undefined);
  });

  it("renders profile section from query-backed settings and dynamic vpn platforms", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OperatorSettings />
      </QueryClientProvider>
    );

    await waitFor(() => expect(fetchSettingsApiMock).toHaveBeenCalled());
    expect(
      screen.getByRole("heading", {
        name: /Global workspace and platform defaults/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Any platform can be removed here/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("system-prompt-selector")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("PwnPilot/project")
    ).toBeInTheDocument();
    await screen.findByRole("heading", { name: /Hack The Box/i });
    await screen.findByRole("heading", { name: /HTB Academy/i });
    await waitFor(() =>
      expect(screen.getByDisplayValue("/vpn/htb.ovpn")).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("/vpn/academy.ovpn")).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getAllByLabelText(/Config path/i)[0]).toHaveValue(
        "/vpn/htb.ovpn"
      )
    );
    expect(
      screen.getByLabelText(/Evaluation lease duration/i)
    ).toHaveValue(30);
    expect(
      screen.getByLabelText(/Evaluation max runtime/i)
    ).toHaveValue(300);
  });

  it("allows adding a platform and importing a vpn file before save", async () => {
    const fileContents = "client\nremote academy.htb 1194\n";
    const fileReaderMock = {
      readAsText: vi.fn(function (this: { onload: null | (() => void) }) {
        Object.defineProperty(this, "result", {
          configurable: true,
          value: fileContents,
        });
        this.onload?.();
      }),
      onload: null as null | (() => void),
      result: null as string | null,
    };
    const fileReaderSpy = vi
      .spyOn(window, "FileReader")
      .mockImplementation(() => fileReaderMock as unknown as FileReader);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <OperatorSettings />
      </QueryClientProvider>
    );

    await waitFor(() => expect(fetchSettingsApiMock).toHaveBeenCalled());
    await screen.findByRole("heading", { name: /HTB Academy/i });
    fireEvent.click(screen.getByRole("button", { name: /Add Platform/i }));

    const platformNameInputs = screen.getAllByLabelText(/Platform Name/i);
    const platformIdInputs = screen.getAllByLabelText(/Platform ID/i);
    const connectCommandInputs = screen.getAllByLabelText(/Connect command/i);

    fireEvent.change(platformNameInputs[platformNameInputs.length - 1], {
      target: { value: "Pro Labs" },
    });
    fireEvent.change(platformIdInputs[platformIdInputs.length - 1], {
      target: { value: "prolabs" },
    });
    fireEvent.change(connectCommandInputs[connectCommandInputs.length - 1], {
      target: { value: "sudo openvpn --config {{vpn_path}}" },
    });

    const vpnFile = new File([fileContents], "prolabs.ovpn", {
      type: "application/x-openvpn-profile",
    });
    const uploadInputs = screen.getAllByLabelText(/Choose VPN File/i);
    fireEvent.change(uploadInputs[uploadInputs.length - 1], {
      target: { files: [vpnFile] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Save Settings$/i }));

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          vpn_platform_defaults: expect.objectContaining({
            prolabs: expect.objectContaining({
              label: "Pro Labs",
              connect_command: "sudo openvpn --config {{vpn_path}}",
              uploaded_file_name: "prolabs.ovpn",
              uploaded_file_content: fileContents,
            }),
          }),
        })
      )
    );

    fileReaderSpy.mockRestore();
  });

  it("autosaves a selected vpn file without waiting for the global save button", async () => {
    const fileContents = "client\nremote release-arena.htb 1194\n";
    const fileReaderMock = {
      readAsText: vi.fn(function (this: { onload: null | (() => void) }) {
        Object.defineProperty(this, "result", {
          configurable: true,
          value: fileContents,
        });
        this.onload?.();
      }),
      onload: null as null | (() => void),
      result: null as string | null,
    };
    const fileReaderSpy = vi
      .spyOn(window, "FileReader")
      .mockImplementation(() => fileReaderMock as unknown as FileReader);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <OperatorSettings />
      </QueryClientProvider>
    );

    await waitFor(() => expect(fetchSettingsApiMock).toHaveBeenCalled());
    const academyHeading = await screen.findByRole("heading", { name: /HTB Academy/i });
    const academyCard = academyHeading.closest("section");
    if (!academyCard) {
      throw new Error("Expected academy VPN card");
    }

    const vpnFile = new File([fileContents], "release_arena_eu-release-2.ovpn", {
      type: "application/x-openvpn-profile",
    });
    fireEvent.change(within(academyCard).getByLabelText(/Choose VPN File/i), {
      target: { files: [vpnFile] },
    });

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          vpn_platform_defaults: expect.objectContaining({
            academy: expect.objectContaining({
              uploaded_file_name: "release_arena_eu-release-2.ovpn",
              uploaded_file_content: fileContents,
            }),
          }),
        })
      )
    );

    fileReaderSpy.mockRestore();
  });

  it("shows a delete action for built-in platforms", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OperatorSettings />
      </QueryClientProvider>
    );

    await waitFor(() => expect(fetchSettingsApiMock).toHaveBeenCalled());
    await screen.findByRole("heading", { name: /Hack The Box/i });
    expect(
      screen.getAllByRole("button", { name: /Delete Platform/i }).length
    ).toBeGreaterThan(0);
  });

  it("shows a clearly labeled delete action for a custom platform", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OperatorSettings />
      </QueryClientProvider>
    );

    await waitFor(() => expect(fetchSettingsApiMock).toHaveBeenCalled());
    const deleteButtonCount = screen.getAllByRole("button", {
      name: /Delete Platform/i,
    }).length;
    fireEvent.click(screen.getByRole("button", { name: /Add Platform/i }));

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /Delete Platform/i })
      ).toHaveLength(deleteButtonCount + 1)
    );
  });

  it("includes platform api token updates without exposing stored secrets", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OperatorSettings />
      </QueryClientProvider>
    );

    await waitFor(() => expect(fetchSettingsApiMock).toHaveBeenCalled());
    const clearTokenButton = await screen.findByRole("button", {
      name: /Clear Token/i,
    });
    const htbCard = clearTokenButton.closest("section");
    if (!htbCard) {
      throw new Error("Expected HTB VPN card");
    }

    const tokenInput = within(htbCard).getByLabelText(/API token/i);
    expect(tokenInput).toHaveAttribute(
      "placeholder",
      "Leave empty to keep the stored token"
    );

    fireEvent.input(tokenInput, {
      target: { value: "new-htb-token" },
    });
    await waitFor(() => expect(tokenInput).toHaveValue("new-htb-token"));
    fireEvent.click(screen.getByRole("button", { name: /Sav/i }));

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          vpn_platform_defaults: expect.objectContaining({
            htb: expect.objectContaining({
              api_token: "new-htb-token",
            }),
          }),
        })
      )
    );
  });

  it("includes report evaluation runtime overrides in the save payload", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OperatorSettings />
      </QueryClientProvider>
    );

    await waitFor(() => expect(fetchSettingsApiMock).toHaveBeenCalled());
    const saveButton = await screen.findByRole("button", {
      name: /^Save Settings$/i,
    });

    fireEvent.change(screen.getByLabelText(/Evaluation lease duration/i), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText(/Heartbeat interval/i), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText(/Reclaim poll interval/i), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText(/Evaluation max runtime/i), {
      target: { value: "480" },
    });
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          report_evaluation_lease_seconds: 45,
          report_evaluation_heartbeat_interval_seconds: 12,
          report_evaluation_reclaim_poll_interval_seconds: 20,
          report_evaluation_max_runtime_seconds: 480,
        })
      )
    );
  });
});
