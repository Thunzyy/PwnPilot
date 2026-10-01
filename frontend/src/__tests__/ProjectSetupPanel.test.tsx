import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ProjectSetupPanel } from "../components/Projects/ProjectSetupPanel";

describe("ProjectSetupPanel", () => {
  it("renders setup fields and vpn platform choices", () => {
    render(
      <ProjectSetupPanel
        open
        onOpenChange={() => {}}
        onSave={() => {}}
        defaultValues={{}}
        vpnPlatforms={[
          {
            id: "htb",
            label: "Hack The Box",
            shortLabel: "HTB",
            description: "Default VPN for HTB labs and machines.",
            config_path: "/vpn/htb.ovpn",
            connect_command: "sudo openvpn {{vpn_path}}",
            file_name: "",
            managed: false,
            isBuiltIn: true,
          },
          {
            id: "academy",
            label: "HTB Academy",
            shortLabel: "HTB Academy",
            description: "Managed VPN profile for HTB Academy.",
            config_path: "/vpn/academy.ovpn",
            connect_command: "sudo openvpn {{vpn_path}}",
            file_name: "academy.ovpn",
            managed: true,
            isBuiltIn: false,
          },
        ]}
      />
    );
    expect(screen.getByText(/Project Setup/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/VPN Platform/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /HTB Academy/i })).toBeInTheDocument();
  });
});
