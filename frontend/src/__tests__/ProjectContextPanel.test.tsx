import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { importProjectContextMetadataMock } = vi.hoisted(() => ({
  importProjectContextMetadataMock: vi.fn(),
}));

vi.mock("@/api/projectContext", () => ({
  importProjectContextMetadata: importProjectContextMetadataMock,
}));

import { ProjectContextPanel } from "../components/Projects/ProjectContextPanel";

describe("ProjectContextPanel", () => {
  beforeEach(() => {
    importProjectContextMetadataMock.mockReset();
    importProjectContextMetadataMock.mockResolvedValue({
      source: "unsupported",
      messages: [],
      context: {},
    });
  });

  it("imports a TryHackMe URL into structured platform fields", () => {
    render(
      <ProjectContextPanel
        projectType="custom"
        variables={{}}
        onSave={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/^Platform URL$/i), {
      target: {
        value: "https://tryhackme.com/room/adventofcyber3",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Import URL/i }));

    return waitFor(() => {
      expect(screen.getByLabelText(/^Platform$/i)).toHaveValue("TryHackMe");
      expect(screen.getByLabelText(/^Content Type$/i)).toHaveValue("room");
      expect(screen.getByLabelText(/^Target Slug$/i)).toHaveValue("adventofcyber3");
      expect(screen.getByLabelText(/^Engagement Type$/i)).toHaveValue("platform_lab");
    });
  });

  it("merges backend HTB enrichment into the imported context", async () => {
    importProjectContextMetadataMock.mockResolvedValue({
      source: "htb_api",
      messages: ["HTB metadata imported. No live machine IP was returned."],
      context: {
        platform_difficulty: "Easy",
        os: "Linux",
        notes: "Cap is an easy Linux machine.",
      },
    });

    render(
      <ProjectContextPanel
        projectType="custom"
        variables={{}}
        onSave={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/^Platform URL$/i), {
      target: {
        value: "https://app.hackthebox.com/machines/Cap?sort_by=created_at&sort_type=desc",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Import URL/i }));

    await waitFor(() =>
      expect(importProjectContextMetadataMock).toHaveBeenCalledWith(
        "https://app.hackthebox.com/machines/Cap?sort_by=created_at&sort_type=desc"
      )
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/^Target Name$/i)).toHaveValue("Cap")
    );
    expect(screen.getByLabelText(/^Difficulty$/i)).toHaveValue("Easy");
    expect(screen.getByLabelText(/^OS$/i)).toHaveValue("Linux");
    expect(screen.getByLabelText(/^Notes$/i)).toHaveValue(
      "Cap is an easy Linux machine."
    );
    expect(
      screen.getByText(/No live machine IP was returned/i)
    ).toBeInTheDocument();
  });

  it("saves merged project variables from the context form", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectContextPanel
        projectType="custom"
        variables={{
          existing_key: "keep-me",
        }}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText(/^Engagement Type$/i), {
      target: { value: "ctf" },
    });
    fireEvent.change(screen.getByLabelText(/^Platform$/i), {
      target: { value: "Hack The Box" },
    });
    fireEvent.change(screen.getByLabelText(/^Target Name$/i), {
      target: { value: "Analytics" },
    });
    fireEvent.change(screen.getByLabelText(/^Target IP$/i), {
      target: { value: "10.10.11.55" },
    });
    fireEvent.change(screen.getByLabelText(/^AI Briefing$/i), {
      target: { value: "Stay concise and track privilege escalation paths." },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save Context/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave).toHaveBeenCalledWith({
      existing_key: "keep-me",
      engagement_kind: "ctf",
      platform_name: "Hack The Box",
      platform_target_name: "Analytics",
      target_ip: "10.10.11.55",
      ai_briefing: "Stay concise and track privilege escalation paths.",
    });
  });
});
