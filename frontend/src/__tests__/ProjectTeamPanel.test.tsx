import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { api } from "@/api/client";
import { ProjectTeamPanel } from "../components/Projects/ProjectTeamPanel";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(async () => ({ data: [] })),
    post: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
  },
}));

describe("ProjectTeamPanel", () => {
  it("renders team header", async () => {
    render(<ProjectTeamPanel projectId="p1" />);
    expect(
      await screen.findByRole("heading", { name: /Team/i })
    ).toBeInTheDocument();
  });

  it("renders collaborator identity details when provided by the API", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [
        {
          id: "m-1",
          user_id: "user-1",
          project_id: "p1",
          role: "admin",
          status: "active",
          source: "invite",
          username: "alice",
          display_name: "Alice Operator",
          email: "alice@example.com",
          team: "Red",
        },
      ],
    });

    render(<ProjectTeamPanel projectId="p1" />);

    expect(await screen.findByText("Alice Operator")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Team Red")).toBeInTheDocument();
    expect(screen.getByText("user-1")).toBeInTheDocument();
  });

  it("surfaces pending access requests separately and lets an admin approve them", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        data: [
          {
            id: "m-pending",
            user_id: "user-2",
            project_id: "p1",
            role: "member",
            status: "pending",
            source: "request",
            username: "bob",
            display_name: "Bob Operator",
            email: "bob@example.com",
            team: "Blue",
          },
          {
            id: "m-active",
            user_id: "user-1",
            project_id: "p1",
            role: "admin",
            status: "active",
            source: "invite",
            username: "alice",
            display_name: "Alice Operator",
            email: "alice@example.com",
            team: "Red",
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "m-pending",
            user_id: "user-2",
            project_id: "p1",
            role: "member",
            status: "active",
            source: "request",
            username: "bob",
            display_name: "Bob Operator",
            email: "bob@example.com",
            team: "Blue",
          },
          {
            id: "m-active",
            user_id: "user-1",
            project_id: "p1",
            role: "admin",
            status: "active",
            source: "invite",
            username: "alice",
            display_name: "Alice Operator",
            email: "alice@example.com",
            team: "Red",
          },
        ],
      });

    render(<ProjectTeamPanel projectId="p1" />);

    const pendingSection = await screen.findByRole("heading", {
      name: /pending access requests/i,
    });
    const pendingContainer = pendingSection.closest("section");

    if (!pendingContainer) {
      throw new Error("Pending section not found");
    }

    expect(within(pendingContainer).getByText("Bob Operator")).toBeInTheDocument();
    expect(within(pendingContainer).getByRole("button", { name: /approve/i })).toBeInTheDocument();

    fireEvent.click(
      within(pendingContainer).getByRole("button", { name: /approve/i })
    );

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/projects/p1/memberships/m-pending", {
        status: "active",
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /pending access requests/i })).not.toBeInTheDocument();
    });
  });
});
