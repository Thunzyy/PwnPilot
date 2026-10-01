import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { VariablesPanel } from "@/components/Commands/VariablesPanel";

describe("VariablesPanel", () => {
  it("renders variables and allows updates", () => {
    const onUpdate = vi.fn();
    render(
      <VariablesPanel
        title="Global Variables"
        variables={{ target_ip: "1.1.1.1" }}
        onVariableChange={onUpdate}
        onVariableRemove={vi.fn()}
        onVariableAdd={vi.fn()}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByText(/Global Variables/i)).toBeInTheDocument();
    const input = screen.getByDisplayValue("1.1.1.1");
    fireEvent.change(input, { target: { value: "2.2.2.2" } });
    expect(onUpdate).toHaveBeenCalled();
  });

  it("supports collapsible mode", () => {
    render(
      <VariablesPanel
        title="Global Variables"
        variables={{ target_ip: "1.1.1.1" }}
        onVariableChange={vi.fn()}
        onVariableRemove={vi.fn()}
        onVariableAdd={vi.fn()}
        onReset={vi.fn()}
        collapsible
        defaultOpen={false}
      />
    );

    expect(screen.queryByDisplayValue("1.1.1.1")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /show global variables/i })
    );

    expect(screen.getByDisplayValue("1.1.1.1")).toBeInTheDocument();
  });
});
