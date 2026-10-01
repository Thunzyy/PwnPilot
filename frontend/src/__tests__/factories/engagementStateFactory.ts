import type { ProjectEngagementState } from "@/types/engagement";

export function createEngagementState(
  overrides: Partial<ProjectEngagementState> = {}
): ProjectEngagementState {
  return {
    version: "v1",
    source: "derived",
    progress: 42,
    sections: [
      {
        id: "recon",
        label: "Reconnaissance",
        isOpen: true,
        items: [{ id: "item-1", label: "nmap -sV", status: "done" }],
      },
    ],
    graph: {
      nodes: [
        {
          id: "node-1",
          type: "initial",
          status: "success",
          title: "nmap -sV",
          subtitle: "Exit 0",
          icon: "radar",
          position: { x: "50%", y: "50%" },
          sectionId: "recon",
          itemId: "recon-port-scan",
        },
      ],
      edges: [],
    },
    ...overrides,
  };
}

