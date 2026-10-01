import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CommandCard } from "@/components/Commands/CommandCard";

describe("CommandCard", () => {
  it("hides run action when onRun is not provided", () => {
    render(
      <CommandCard
        id="1"
        name="Test"
        category="Recon"
        command="nmap {target_ip}"
        description="Desc"
        tags={[]}
        onCopy={vi.fn()}
      />
    );

    expect(screen.queryByText(/Run Command/i)).not.toBeInTheDocument();
  });

  it("shows run action when onRun is provided", () => {
    render(
      <CommandCard
        id="1"
        name="Test"
        category="Recon"
        command="nmap {target_ip}"
        description="Desc"
        tags={[]}
        onCopy={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(screen.getByText(/Run Command/i)).toBeInTheDocument();
  });
});
