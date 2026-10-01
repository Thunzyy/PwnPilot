import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Sidebar } from "../Sidebar";

describe("Sidebar", () => {
  it("shows loading state while engagement data is loading", () => {
    render(
      <Sidebar
        sections={[]}
        progress={0}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
        isLoading
      />
    );

    expect(
      screen.getByText(/loading engagement checklist/i)
    ).toBeInTheDocument();
  });

  it("shows error state when engagement retrieval fails", () => {
    render(
      <Sidebar
        sections={[]}
        progress={0}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
        errorMessage="Failed to load project engagement state"
      />
    );

    expect(
      screen.getByText(/failed to load project engagement state/i)
    ).toBeInTheDocument();
  });

  it("shows observed empty state when no evidence-backed items exist", () => {
    render(
      <Sidebar
        sections={[
          { id: "recon", label: "Recon", isOpen: false, items: [] },
          { id: "exploitation", label: "Exploitation", isOpen: false, items: [] },
        ]}
        progress={0}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
      />
    );

    expect(screen.getByText(/no observed progress yet/i)).toBeInTheDocument();
  });

  it("renders only observed methodology steps by default", () => {
    render(
      <Sidebar
        sections={[
          {
            id: "recon",
            label: "Recon",
            isOpen: true,
            items: [
              {
                id: "recon-port-scan",
                label: "Port Scan",
                status: "done",
                evidenceCount: 1,
              },
              {
                id: "recon-dns",
                label: "DNS Enumeration",
                status: "pending",
              },
            ],
          },
          {
            id: "exploitation",
            label: "Exploitation",
            isOpen: true,
            items: [
              {
                id: "exploit-sqli",
                label: "SQL Injection Exploitation",
                status: "pending",
              },
            ],
          },
        ]}
        progress={25}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
      />
    );

    expect(screen.getByText(/observed progress/i)).toBeInTheDocument();
    expect(screen.getByText(/port scan/i)).toBeInTheDocument();
    expect(screen.queryByText(/dns enumeration/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sql injection exploitation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/exploitation/i)).not.toBeInTheDocument();
  });

  it("suggests next actions and evidence gaps from observed progress", () => {
    render(
      <Sidebar
        sections={[
          {
            id: "recon",
            label: "Recon",
            isOpen: true,
            items: [
              {
                id: "recon-port-scan",
                label: "Port Scan",
                status: "done",
                evidenceCount: 1,
                successCount: 1,
              },
            ],
          },
          {
            id: "exploitation",
            label: "Exploitation",
            isOpen: false,
            items: [
              {
                id: "exploit-foothold",
                label: "Remote Login / Foothold",
                status: "pending",
              },
            ],
          },
        ]}
        progress={30}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
      />
    );

    expect(screen.getByText(/next actions/i)).toBeInTheDocument();
    expect(
      screen.getByText(/probe exposed services for a foothold path/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/evidence gaps/i)).toBeInTheDocument();
    expect(
      screen.getByText(/initial access is not evidenced yet/i)
    ).toBeInTheDocument();
  });

  it("hides adaptive methodology cards in complete methodology view", () => {
    render(
      <Sidebar
        sections={[
          {
            id: "recon",
            label: "Recon",
            isOpen: true,
            items: [
              {
                id: "recon-port-scan",
                label: "Port Scan",
                status: "done",
                evidenceCount: 1,
                successCount: 1,
              },
              {
                id: "recon-dns",
                label: "DNS Enumeration",
                status: "pending",
              },
            ],
          },
        ]}
        progress={20}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
      />
    );

    expect(screen.getByText(/next actions/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /methodology/i }));

    expect(screen.queryByText(/next actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/evidence gaps/i)).not.toBeInTheDocument();
    expect(screen.getByText(/dns enumeration/i)).toBeInTheDocument();
  });

  it("labels observed items with confidence, source, and evidence count", () => {
    render(
      <Sidebar
        projectId="project-1"
        sections={[
          {
            id: "exploitation",
            label: "Exploitation",
            isOpen: true,
            items: [
              {
                id: "exploit-creds",
                label: "Credential Discovery (attack_graph)",
                status: "done",
                evidenceCount: 2,
                successCount: 1,
                lastSeenAt: "2026-04-13T09:34:00.000Z",
              },
            ],
          },
        ]}
        progress={40}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
      />
    );

    expect(screen.getByText(/credential discovery/i)).toBeInTheDocument();
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/attack graph/i)).toBeInTheDocument();
    expect(screen.getByText(/2 evidence/i)).toBeInTheDocument();
  });

  it("opens evidence details on item click without toggling status", () => {
    const onToggleItem = vi.fn();

    render(
      <Sidebar
        projectId="project-1"
        sections={[
          {
            id: "exploitation",
            label: "Exploitation",
            isOpen: true,
            items: [
              {
                id: "exploit-creds",
                label: "Credential Discovery (attack_graph)",
                status: "done",
                evidenceCount: 2,
                successCount: 1,
                failureCount: 0,
                lastSeenAt: "2026-04-13T09:34:00.000Z",
              },
            ],
          },
        ]}
        progress={40}
        onToggleItem={onToggleItem}
        onToggleSection={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/credential discovery/i));

    expect(screen.getByText(/evidence details/i)).toBeInTheDocument();
    expect(screen.getByText(/source: attack graph/i)).toBeInTheDocument();
    expect(screen.getByText(/confidence: confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence events: 2/i)).toBeInTheDocument();
    expect(screen.getByText(/successful events: 1/i)).toBeInTheDocument();
    expect(onToggleItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /cycle credential discovery/i }));

    expect(onToggleItem).toHaveBeenCalledWith("exploitation", "exploit-creds");
  });

  it("can be opened on a selected evidence item from an external controller", () => {
    const onSelectedEvidenceItemChange = vi.fn();

    render(
      <Sidebar
        projectId="project-1"
        sections={[
          {
            id: "exploitation",
            label: "Exploitation",
            isOpen: true,
            items: [
              {
                id: "exploit-remote-login",
                label: "Remote Login / Foothold",
                status: "done",
                evidenceCount: 1,
                successCount: 1,
              },
            ],
          },
        ]}
        progress={45}
        selectedEvidenceItem={{
          sectionId: "exploitation",
          itemId: "exploit-remote-login",
        }}
        onSelectedEvidenceItemChange={onSelectedEvidenceItemChange}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
      />
    );

    expect(screen.getByText(/evidence details/i)).toBeInTheDocument();
    expect(screen.getAllByText(/remote login \/ foothold/i).length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: /close evidence details/i })
    );

    expect(onSelectedEvidenceItemChange).toHaveBeenCalledWith(null);
  });

  it("uses linked graph nodes as concrete evidence for an observed item", () => {
    render(
      <Sidebar
        projectId="project-1"
        sections={[
          {
            id: "exploitation",
            label: "Exploitation",
            isOpen: true,
            items: [
              {
                id: "exploit-remote-login",
                label: "Remote Login / Foothold",
                status: "done",
              },
            ],
          },
        ]}
        graphNodes={[
          {
            id: "cmd-ssh-login",
            type: "success",
            status: "success",
            title: "ssh nathan@10.129.34.191",
            subtitle: "Exit 0",
            icon: "terminal",
            position: { x: "30%", y: "40%" },
            sectionId: "exploitation",
            itemId: "exploit-remote-login",
          },
          {
            id: "cmd-root-shell",
            type: "success",
            status: "success",
            title: "python3.8 cap_setuid root shell",
            subtitle: "Exit 0",
            icon: "terminal",
            position: { x: "70%", y: "40%" },
            sectionId: "privesc",
            itemId: "privesc-linux-enum",
          },
        ]}
        progress={45}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
      />
    );

    expect(screen.getByText(/remote login \/ foothold/i)).toBeInTheDocument();
    expect(screen.getByText(/graph evidence/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/remote login \/ foothold/i));

    expect(screen.getByText(/linked graph evidence/i)).toBeInTheDocument();
    expect(screen.getByText("ssh nathan@10.129.34.191")).toBeInTheDocument();
    expect(screen.getByText(/command history/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in history/i })).toHaveAttribute(
      "href",
      "/projects/project-1/timeline?commandId=cmd-ssh-login"
    );
    expect(screen.queryByText(/python3\.8 cap_setuid root shell/i)).not.toBeInTheDocument();
  });

  it("can reveal the complete methodology on demand", () => {
    render(
      <Sidebar
        sections={[
          {
            id: "recon",
            label: "Recon",
            isOpen: true,
            items: [
              { id: "recon-port-scan", label: "Port Scan", status: "pending" },
              { id: "recon-web-discovery", label: "Web Content Discovery", status: "pending" },
            ],
          },
          {
            id: "exploitation",
            label: "Exploitation",
            isOpen: false,
            items: [
              { id: "exploit-sqli", label: "SQL Injection Exploitation", status: "pending" },
            ],
          },
        ]}
        progress={0}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
      />
    );

    expect(screen.queryByText(/port scan/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no observed progress yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /methodology/i }));

    expect(screen.getByText(/target methodology/i)).toBeInTheDocument();
    expect(screen.getByText(/port scan/i)).toBeInTheDocument();
    expect(screen.getByText(/web content discovery/i)).toBeInTheDocument();
    expect(screen.queryByText(/no observed progress yet/i)).not.toBeInTheDocument();
  });

  it("labels the mission as complete at 100 percent progress", () => {
    render(
      <Sidebar
        sections={[
          {
            id: "postexp",
            label: "Post-Exploitation",
            isOpen: true,
            items: [
              { id: "postexp-loot", label: "Loot / Data Collection", status: "done" },
            ],
          },
        ]}
        progress={100}
        onToggleItem={vi.fn()}
        onToggleSection={vi.fn()}
      />
    );

    expect(screen.getByText("COMPLETE")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
