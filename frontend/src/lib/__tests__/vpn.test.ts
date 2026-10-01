import { describe, expect, it } from "vitest";

import { getVpnPlatformList, resolveProjectVpnConnection } from "../vpn";
import type { Settings } from "@/types";

describe("vpn helpers", () => {
  it("hides disabled built-in platforms from default lists and project resolution", () => {
    const settings: Settings = {
      workspace_base_path: "PwnPilot/project",
      vault_path: "",
      vpn_path: "",
      vpn_content: "",
      vpn_platform_defaults: {
        htb: {
          label: "Hack The Box",
          connect_command: "sudo openvpn {{vpn_path}}",
          disabled: true,
        },
        academy: {
          label: "HTB Academy",
          config_path: "/vpn/academy.ovpn",
          connect_command: "sudo openvpn {{vpn_path}}",
        },
      },
    };

    expect(getVpnPlatformList(settings).map((platform) => platform.id)).not.toContain(
      "htb"
    );
    expect(
      getVpnPlatformList(settings, { includeDisabled: true }).find(
        (platform) => platform.id === "htb"
      )?.disabled
    ).toBe(true);

    const resolved = resolveProjectVpnConnection(
      {
        name: "HTB Box",
        slug: "htb-box",
        workspace_path: "/tmp/htb-box",
        type: "htb",
        variables: {},
      },
      settings
    );

    expect(resolved.configPath).toBe("");
    expect(resolved.command).toBeNull();
    expect(resolved.reason).toMatch(/Configure a VPN path/i);
  });
});
