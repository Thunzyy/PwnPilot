/**
 * MarkdownViewer Component Rendering Tests (RENDER-01, RENDER-02)
 *
 * Validates that the markdown rendering pipeline produces correct DOM output:
 * - Standard markdown (headings, bold/italic, lists, blockquotes)
 * - GFM extensions (tables, task lists)
 * - Code blocks with syntax highlighting, line numbers, copy button
 * - Obsidian callouts with data attributes
 * - FrontmatterHeader with title, date, tags, custom fields
 * - Edge cases (null body, empty body, frontmatter YAML stripping)
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { MarkdownViewer } from "../MarkdownViewer";
import { FrontmatterHeader } from "../FrontmatterHeader";
import { makeDoc } from "./helpers";

const { layoutAttackGraphMock } = vi.hoisted(() => ({
  layoutAttackGraphMock: vi.fn(async () => ({
    "graph-node-1": { x: 0, y: 0 },
    "graph-node-2": { x: 320, y: 0 },
  })),
}));

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>(
    "@xyflow/react",
  );

  return {
    ...actual,
    ReactFlow: ({
      children,
      nodes,
    }: {
      children?: ReactNode;
      nodes?: Array<{ id: string }>;
    }) => (
      <div
        data-testid="report-attack-graph-flow"
        data-node-count={String(nodes?.length ?? 0)}
      >
        {children}
      </div>
    ),
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: {
      Left: "left",
      Right: "right",
      Top: "top",
      Bottom: "bottom",
    },
    MarkerType: {
      ArrowClosed: "arrowclosed",
    },
  };
});

vi.mock("@/features/attack-graph/useProjectGraph", () => ({
  useProjectGraph: () => ({
    graph: {
      projectId: "proj-1",
      source: "stored" as const,
      nodes: [
        {
          id: "graph-node-1",
          projectId: "proj-1",
          type: "host" as const,
          label: "10.129.34.191",
          createdAt: "2026-04-23T00:00:00Z",
          updatedAt: "2026-04-23T00:00:00Z",
          createdBy: "rule" as const,
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: null,
          meta: { ip: "10.129.34.191" },
        },
        {
          id: "graph-node-2",
          projectId: "proj-1",
          type: "session" as const,
          label: "SSH session: nathan@10.129.34.191",
          createdAt: "2026-04-23T00:00:00Z",
          updatedAt: "2026-04-23T00:00:00Z",
          createdBy: "rule" as const,
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: null,
          meta: { user: "nathan", shell_type: "ssh" },
        },
      ],
      edges: [
        {
          id: "graph-edge-1",
          projectId: "proj-1",
          sourceId: "graph-node-1",
          targetId: "graph-node-2",
          kind: "opens_session_on" as const,
          sourceStepId: null,
          command: null,
          tool: null,
          createdAt: "2026-04-23T00:00:00Z",
          confidence: 1,
          label: "opens session",
          meta: {},
        },
      ],
      scenarios: [],
      activeScenarioId: null,
    },
    isLoading: false,
    error: null,
    proposals: [],
    isProposalsLoading: false,
    isSeeding: false,
    seedDemoCtf: vi.fn(),
    isPathLoading: false,
    pathResult: null,
    loadShortestPath: vi.fn(),
    acceptingProposalId: null,
    acceptProposal: vi.fn(),
    updateNodePosition: vi.fn(),
  }),
}));

vi.mock("@/features/attack-graph/layout", () => ({
  ATTACK_GRAPH_NODE_WIDTH: 280,
  ATTACK_GRAPH_NODE_HEIGHT: 104,
  layoutAttackGraph: layoutAttackGraphMock,
}));

// =============================================================================
// RENDER-01: Standard Markdown
// =============================================================================

describe("MarkdownViewer - Standard Markdown (RENDER-01)", () => {
  it("renders headings as h1-h6 elements", () => {
    const body = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    expect(container.querySelector("h1")?.textContent).toBe("H1");
    expect(container.querySelector("h2")?.textContent).toBe("H2");
    expect(container.querySelector("h3")?.textContent).toBe("H3");
    expect(container.querySelector("h4")?.textContent).toBe("H4");
    expect(container.querySelector("h5")?.textContent).toBe("H5");
    expect(container.querySelector("h6")?.textContent).toBe("H6");
  });

  it("renders bold and italic text", () => {
    const body = "**bold** and *italic*";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    const strong = container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe("bold");

    const em = container.querySelector("em");
    expect(em).toBeTruthy();
    expect(em?.textContent).toBe("italic");
  });

  it("renders unordered and ordered lists", () => {
    const body = "- item 1\n- item 2\n\n1. first\n2. second";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    const ul = container.querySelector("ul");
    expect(ul).toBeTruthy();
    const ulItems = ul?.querySelectorAll("li");
    expect(ulItems?.length).toBeGreaterThanOrEqual(2);

    const ol = container.querySelector("ol");
    expect(ol).toBeTruthy();
    const olItems = ol?.querySelectorAll("li");
    expect(olItems?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders blockquotes", () => {
    const body = "> quoted text";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    const blockquote = container.querySelector("blockquote");
    expect(blockquote).toBeTruthy();
    expect(blockquote?.textContent).toContain("quoted text");
  });

  it("renders GFM tables", () => {
    const body = "| A | B |\n|---|---|\n| 1 | 2 |";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector("thead")).toBeTruthy();
    expect(container.querySelector("tbody")).toBeTruthy();

    const thCells = container.querySelectorAll("th");
    expect(thCells.length).toBeGreaterThanOrEqual(2);
    expect(thCells[0]?.textContent).toBe("A");
    expect(thCells[1]?.textContent).toBe("B");

    const tdCells = container.querySelectorAll("td");
    expect(tdCells.length).toBeGreaterThanOrEqual(2);
    expect(tdCells[0]?.textContent).toBe("1");
    expect(tdCells[1]?.textContent).toBe("2");
  });

  it("renders GFM task lists", () => {
    const body = "- [x] done\n- [ ] todo";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);

    // First checkbox should be checked (done)
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    // Second checkbox should be unchecked (todo)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
  });

  it("renders inline code", () => {
    const body = "`nmap -sV`";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code?.textContent).toBe("nmap -sV");
  });

  it("renders links with correct href", () => {
    const body = "[Example](https://example.com)";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    const link = container.querySelector("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.textContent).toBe("Example");
  });

  it("renders horizontal rules", () => {
    const body = "above\n\n---\n\nbelow";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    expect(container.querySelector("hr")).toBeTruthy();
  });

  it("renders a visual attack graph embed inside report attack path sections", async () => {
    const doc = makeDoc("# Cap\n\n## Attack Path\n\n1. Enumerated the target.");
    doc.relative_path = "report.md";

    render(<MarkdownViewer doc={doc} />);

    expect(await screen.findByTestId("report-attack-graph-embed")).toBeInTheDocument();
    expect(screen.getByTestId("report-attack-graph-flow")).toHaveAttribute(
      "data-node-count",
      "4",
    );
    expect(screen.getByText("Attack graph visual")).toBeInTheDocument();
  });

  it("treats absolute report paths as report markdown for attack graph embeds", async () => {
    const doc = makeDoc("# Cap\n\n## Attack Path\n\n1. Enumerated the target.");
    doc.relative_path = "/home/operator/PwnPilot/projects/htb-cap-canonical-flow/report.md";

    render(<MarkdownViewer doc={doc} />);

    expect(await screen.findByTestId("report-attack-graph-embed")).toBeInTheDocument();
  });

  it("renders report attack graph image references as a live graph embed", async () => {
    const doc = makeDoc("# Cap\n\n## Attack Graph\n\n![Attack Graph](attack-graph.svg)");
    doc.relative_path = "report.md";

    const { container } = render(<MarkdownViewer doc={doc} />);

    expect(await screen.findByTestId("report-attack-graph-embed")).toBeInTheDocument();
    expect(screen.getByTestId("report-attack-graph-flow")).toHaveAttribute(
      "data-node-count",
      "4",
    );
    expect(container.querySelector('img[src="attack-graph.svg"]')).toBeNull();
  });

  it("renders exported PNG attack graph references as a live graph embed", async () => {
    const doc = makeDoc("# Cap\n\n## Attack Graph\n\n![Attack Graph](attack-graph.png)");
    doc.relative_path = "report.md";

    const { container } = render(<MarkdownViewer doc={doc} />);

    expect(await screen.findByTestId("report-attack-graph-embed")).toBeInTheDocument();
    expect(container.querySelector('img[src="attack-graph.png"]')).toBeNull();
  });
});

// =============================================================================
// RENDER-02: Code Blocks
// =============================================================================

describe("MarkdownViewer - Code Blocks (RENDER-02)", () => {
  it("renders code blocks with syntax highlighting classes", () => {
    const body = '```python\ndef hello():\n    print("world")\n```';
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    // Should have a code element with language-python class
    const codeEl = container.querySelector("code");
    expect(codeEl).toBeTruthy();
    expect(codeEl?.className).toMatch(/language-python/);

    // rehype-highlight should produce spans with hljs-* classes
    const hljsSpans = container.querySelectorAll("span[class*='hljs-']");
    expect(hljsSpans.length).toBeGreaterThan(0);
  });

  it("displays language label", () => {
    const body = "```bash\necho hello\n```";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    // CodeBlock renders a language label in the header
    const langLabel = container.querySelector(".code-block-lang");
    expect(langLabel).toBeTruthy();
    expect(langLabel?.textContent?.toLowerCase()).toContain("bash");
  });

  it("renders copy button", () => {
    const body = "```bash\necho hello\n```";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    // CopyButton has aria-label "Copy code"
    const copyBtn = container.querySelector('[aria-label="Copy code"]');
    expect(copyBtn).toBeTruthy();
  });

  it("renders line numbers", () => {
    const body = "```python\nline1\nline2\nline3\n```";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    // CodeBlock renders line numbers in a gutter
    const gutter = container.querySelector(".code-block-gutter");
    expect(gutter).toBeTruthy();

    const gutterLines = container.querySelectorAll(".code-block-gutter-line");
    expect(gutterLines.length).toBe(3);
    expect(gutterLines[0]?.textContent).toBe("1");
    expect(gutterLines[1]?.textContent).toBe("2");
    expect(gutterLines[2]?.textContent).toBe("3");
  });

  it("renders code block wrapper structure", () => {
    const body = "```js\nconst x = 1;\n```";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    // Full CodeBlock structure: wrapper > header + body > gutter + pre
    expect(container.querySelector(".code-block-wrapper")).toBeTruthy();
    expect(container.querySelector(".code-block-header")).toBeTruthy();
    expect(container.querySelector(".code-block-body")).toBeTruthy();
  });

  it("defaults to 'text' for unspecified language", () => {
    const body = "```\nno language\n```";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    const langLabel = container.querySelector(".code-block-lang");
    expect(langLabel?.textContent?.toLowerCase()).toBe("text");
  });
});

// =============================================================================
// RENDER-01: Callouts
// =============================================================================

describe("MarkdownViewer - Callouts (RENDER-01)", () => {
  it("transforms callout syntax into structured div (not plain blockquote)", () => {
    const body = "> [!info]\n> This is an info callout";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    // rehype-callouts transforms the blockquote into a structured div.
    // The key assertion: callout syntax does NOT render as a plain <blockquote>.
    // Instead it becomes nested divs with the callout title text and body.
    const article = container.querySelector("article.markdown-viewer");
    expect(article).toBeTruthy();

    // No blockquote (callout was transformed)
    expect(container.querySelector("blockquote")).toBeNull();

    // Callout title text "Info" is rendered
    expect(container.textContent).toContain("Info");
    // Callout body is rendered
    expect(container.textContent).toContain("This is an info callout");
  });

  it("renders different callout types with correct title text", () => {
    const body = "> [!warning]\n> Watch out!";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    expect(container.textContent).toContain("Warning");
    expect(container.textContent).toContain("Watch out!");
    // Not a blockquote
    expect(container.querySelector("blockquote")).toBeNull();
  });

  it("renders foldable callout with details/summary", () => {
    const body = "> [!tip]-\n> Collapsed tip content";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    // Foldable callouts use <details>/<summary> elements
    const details = container.querySelector("details");
    expect(details).toBeTruthy();

    const summary = container.querySelector("summary");
    expect(summary).toBeTruthy();

    // Title and content rendered
    expect(container.textContent).toContain("Tip");
    expect(container.textContent).toContain("Collapsed tip content");
  });
});

// =============================================================================
// FrontmatterHeader
// =============================================================================

describe("FrontmatterHeader", () => {
  it("renders title from frontmatter", () => {
    const { container } = render(
      <FrontmatterHeader frontmatter={{ title: "My Note" }} />,
    );

    const h1 = container.querySelector("h1");
    expect(h1).toBeTruthy();
    expect(h1?.textContent).toBe("My Note");
  });

  it("renders clickable tag pills", () => {
    const onTagClick = vi.fn();
    const { container } = render(
      <FrontmatterHeader
        frontmatter={{ tags: ["nmap", "recon"] }}
        onTagClick={onTagClick}
      />,
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.textContent).toBe("nmap");
    expect(buttons[1]?.textContent).toBe("recon");

    // Click first tag
    fireEvent.click(buttons[0]!);
    expect(onTagClick).toHaveBeenCalledWith("nmap");

    // Click second tag
    fireEvent.click(buttons[1]!);
    expect(onTagClick).toHaveBeenCalledWith("recon");
  });

  it("renders date", () => {
    const { container } = render(
      <FrontmatterHeader frontmatter={{ date: "2025-06-15" }} />,
    );

    // formatDate produces locale-formatted string
    expect(container.textContent).toContain("June");
    expect(container.textContent).toContain("15");
    expect(container.textContent).toContain("2025");
  });

  it("renders unknown custom fields as key:value", () => {
    const { container } = render(
      <FrontmatterHeader
        frontmatter={{ target: "10.0.0.1", scope: "internal" }}
      />,
    );

    expect(container.textContent).toContain("target");
    expect(container.textContent).toContain("10.0.0.1");
    expect(container.textContent).toContain("scope");
    expect(container.textContent).toContain("internal");
  });

  it("handles comma-separated tag strings", () => {
    const onTagClick = vi.fn();
    const { container } = render(
      <FrontmatterHeader
        frontmatter={{ tags: "nmap, recon, privesc" }}
        onTagClick={onTagClick}
      />,
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(3);
    expect(buttons[0]?.textContent).toBe("nmap");
    expect(buttons[1]?.textContent).toBe("recon");
    expect(buttons[2]?.textContent).toBe("privesc");
  });

  it("renders array values as comma-separated text", () => {
    const { container } = render(
      <FrontmatterHeader
        frontmatter={{ tools: ["nmap", "gobuster", "ffuf"] }}
      />,
    );

    expect(container.textContent).toContain("tools");
    expect(container.textContent).toContain("nmap, gobuster, ffuf");
  });

  it("does not render when frontmatter is empty", () => {
    const { container } = render(
      <MarkdownViewer doc={makeDoc("content", {})} />,
    );

    // No frontmatter header element (the h1 from FrontmatterHeader)
    const h1 = container.querySelector("h1");
    // The only content should be from markdown body
    expect(h1).toBeNull();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("MarkdownViewer - Edge Cases", () => {
  it("handles null body gracefully", () => {
    expect(() => {
      render(
        <MarkdownViewer doc={makeDoc(null as unknown as string)} />,
      );
    }).not.toThrow();
  });

  it("handles empty string body", () => {
    const { container } = render(<MarkdownViewer doc={makeDoc("")} />);

    // Should render the "No content available" placeholder
    expect(container.textContent).toContain("No content available");
  });

  it("does not render YAML frontmatter as visible text", () => {
    const body = "---\ntitle: Secret\n---\n\nVisible content";
    const { container } = render(<MarkdownViewer doc={makeDoc(body)} />);

    // The YAML fence markers should not appear as text
    // Note: DOMPurify strips HTML, but YAML fences are plain text --
    // remark-frontmatter should strip them from the AST
    expect(container.textContent).toContain("Visible content");
    // The --- delimiters should not be visible text (stripped by remark-frontmatter)
    const textContent = container.textContent ?? "";
    const withoutExpected = textContent.replace("Visible content", "").trim();
    // Should not contain raw frontmatter key-value
    expect(withoutExpected).not.toContain("title: Secret");
  });

  it("handles body with only whitespace", () => {
    const { container } = render(
      <MarkdownViewer doc={makeDoc("   \n\n   ")} />,
    );

    // Whitespace-only body may render as empty or "No content"
    // The important thing is no errors
    expect(container).toBeTruthy();
  });

  it("renders doc with both frontmatter and body content", () => {
    const doc = makeDoc("## Body heading\n\nParagraph text", {
      title: "My Note",
      tags: ["test"],
      target: "10.0.0.1",
    });
    const { container } = render(<MarkdownViewer doc={doc} />);

    // Title and tags are hidden (displayed in KBDocViewer instead)
    expect(container.textContent).not.toContain("My Note");

    // Other frontmatter fields still render
    expect(container.textContent).toContain("10.0.0.1");

    // Body rendered
    expect(container.querySelector("h2")?.textContent).toBe("Body heading");
    expect(container.textContent).toContain("Paragraph text");
  });
});
