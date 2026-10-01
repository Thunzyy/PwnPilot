import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";

import { TypedGraphNode } from "../TypedGraphNode";

type TypedGraphNodeProps = ComponentProps<typeof TypedGraphNode>;

describe("TypedGraphNode", () => {
  it("renders with a stable fixed width to match graph layout spacing", () => {
    render(
      <ReactFlowProvider>
        <TypedGraphNode
          {...({
            selected: false,
            data: {
              node: {
                id: "node-1",
                projectId: "p1",
                type: "action",
                label:
                  "Very long attack graph command node that should not stretch unpredictably",
                createdAt: "2026-04-13T12:00:00Z",
                updatedAt: "2026-04-13T12:00:00Z",
                createdBy: "import",
                confidence: 1,
                sourceStepIds: [],
                tags: ["recon"],
                notes: null,
                position: { x: 0, y: 0 },
                meta: {
                  command:
                    "nmap -sV -Pn 10.10.110.10 --script vuln --reason --version-all",
                },
              },
              highlighted: false,
            },
          } satisfies TypedGraphNodeProps)}
        />
      </ReactFlowProvider>
    );

    const card = screen
      .getByRole("button", {
        name: /graph node very long attack graph command node/i,
      })
      .closest("div");

    expect(card?.className).toContain("w-[280px]");
  });

  it("renders drag feedback without pulsing while a node is moving or settling", () => {
    render(
      <ReactFlowProvider>
        <TypedGraphNode
          {...({
            selected: false,
            dragging: true,
            data: {
              node: {
                id: "node-2",
                projectId: "p1",
                type: "session",
                label: "www-data@WEB01",
                createdAt: "2026-04-13T12:00:00Z",
                updatedAt: "2026-04-13T12:00:00Z",
                createdBy: "import",
                confidence: 1,
                sourceStepIds: [],
                tags: [],
                notes: null,
                position: { x: 0, y: 0 },
                meta: {
                  user: "www-data",
                },
              },
              highlighted: false,
              isDropAnimating: true,
            },
          } satisfies TypedGraphNodeProps)}
        />
      </ReactFlowProvider>
    );

    const card = screen
      .getByRole("button", { name: /graph node www-data@web01/i })
      .closest("div");

    expect(card?.className).toContain("shadow-[0_0_0_1px_rgba(125,211,252,0.45),0_0_32px_rgba(14,165,233,0.28)]");
    expect(card?.className).not.toContain("scale-[1.02]");
    expect(
      screen.getByTestId("attack-graph-drag-feedback").className
    ).not.toContain("animate-pulse");
  });
});
