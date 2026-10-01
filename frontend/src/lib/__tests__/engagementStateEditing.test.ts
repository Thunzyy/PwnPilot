import { describe, expect, it } from "vitest";

import { buildVisualMapDemoState } from "../engagement/demoScenario";
import {
  addGraphNode,
  deleteGraphNode,
  moveGraphNode,
  updateGraphNode,
} from "../engagement/stateEditing";

describe("engagement state editing", () => {
  it("adds a custom node and rebuilds deterministic edges", () => {
    const state = buildVisualMapDemoState("htb", "web");

    const next = addGraphNode(state, {
      afterNodeId: "demo-sqlmap",
      sectionId: "exploitation",
      title: "Manual shell validation",
      subtitle: "Operator note",
    });

    const inserted = next.graph.nodes.find((node) =>
      /manual shell validation/i.test(node.title)
    );

    expect(inserted).toBeDefined();
    expect(next.graph.edges.some((edge) => edge.targetId === inserted?.id)).toBe(
      true
    );
    expect(
      next.graph.edges.every((edge) =>
        next.graph.nodes.some((node) => node.id === edge.sourceId) &&
        next.graph.nodes.some((node) => node.id === edge.targetId)
      )
    ).toBe(true);
  });

  it("updates node metadata and position without mutating unrelated nodes", () => {
    const state = buildVisualMapDemoState("htb", "ad");

    const next = updateGraphNode(state, "demo-bloodhound", {
      title: "bloodhound-python -c All -zip",
      subtitle: "Operator confirmed graph collection",
      status: "success",
      position: {
        x: "91%",
        y: "40%",
      },
    });

    const updated = next.graph.nodes.find((node) => node.id === "demo-bloodhound");
    const untouched = next.graph.nodes.find((node) => node.id === "demo-netexec");

    expect(updated?.title).toMatch(/-zip/);
    expect(updated?.subtitle).toMatch(/confirmed/i);
    expect(updated?.position).toEqual({ x: "91%", y: "40%" });
    expect(untouched?.title).toMatch(/netexec/i);
  });

  it("moves and deletes nodes cleanly", () => {
    const state = buildVisualMapDemoState("htb", "pivoting");
    const moved = moveGraphNode(state, "demo-chisel", {
      x: "64%",
      y: "22%",
    });

    expect(
      moved.graph.nodes.find((node) => node.id === "demo-chisel")?.position
    ).toEqual({
      x: "64%",
      y: "22%",
    });

    const deleted = deleteGraphNode(moved, "demo-chisel");

    expect(deleted.graph.nodes.some((node) => node.id === "demo-chisel")).toBe(
      false
    );
    expect(
      deleted.graph.edges.some(
        (edge) => edge.sourceId === "demo-chisel" || edge.targetId === "demo-chisel"
      )
    ).toBe(false);
  });
});
