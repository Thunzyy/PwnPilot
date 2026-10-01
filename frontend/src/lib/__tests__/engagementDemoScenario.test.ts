import { describe, expect, it } from "vitest";

import {
  ENGAGEMENT_DEMO_PROFILES,
  buildVisualMapDemoState,
  getVisualMapDemoLabel,
} from "../engagement/demoScenario";

describe("visual map demo scenario", () => {
  it("builds a coherent realistic ctf graph payload", () => {
    const state = buildVisualMapDemoState("htb", "web");

    expect(state.version).toBe("v1");
    expect(state.progress).toBeGreaterThan(0);
    expect(state.sections.map((section) => section.id)).toEqual([
      "recon",
      "exploitation",
      "privesc",
      "postexp",
    ]);
    expect(state.graph.nodes).toHaveLength(9);
    expect(state.graph.edges.length).toBeGreaterThan(0);
    expect(
      state.graph.nodes.some((node) => node.title.includes("sqlmap"))
    ).toBe(true);
    expect(
      state.graph.nodes.some(
        (node) => node.status === "failure" && node.sectionId === "exploitation"
      )
    ).toBe(true);

    const nodeIds = new Set(state.graph.nodes.map((node) => node.id));
    expect(
      state.graph.edges.every(
        (edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)
      )
    ).toBe(true);
    expect(
      state.graph.edges.some((edge) => edge.kind === "phase-transition")
    ).toBe(true);
  });

  it("exposes multiple realistic demo profiles with distinct paths", () => {
    expect(ENGAGEMENT_DEMO_PROFILES.map((profile) => profile.id)).toEqual([
      "web",
      "ad",
      "pivoting",
      "cloud",
    ]);

    const web = buildVisualMapDemoState("htb", "web");
    const ad = buildVisualMapDemoState("htb", "ad");
    const pivoting = buildVisualMapDemoState("htb", "pivoting");
    const cloud = buildVisualMapDemoState("htb", "cloud");

    expect(web.graph.nodes.some((node) => /sqlmap/i.test(node.title))).toBe(true);
    expect(
      ad.graph.nodes.some((node) => /bloodhound-python|netexec|winpeas/i.test(node.title))
    ).toBe(true);
    expect(
      pivoting.graph.nodes.some((node) => /ligolo|chisel|proxychains/i.test(node.title))
    ).toBe(true);
    expect(
      cloud.graph.nodes.some((node) => /aws|az |gcloud/i.test(node.title))
    ).toBe(true);
  });

  it("derives a project-type specific CTA label", () => {
    expect(getVisualMapDemoLabel("htb")).toMatch(/realistic ctf demo/i);
    expect(getVisualMapDemoLabel("ctf")).toMatch(/ctf demo/i);
    expect(getVisualMapDemoLabel("thm")).toMatch(/tryhackme-style demo/i);
    expect(getVisualMapDemoLabel("real")).toMatch(/red-team style demo/i);
  });
});
