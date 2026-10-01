/**
 * KBNavBar & KBFileBreadcrumb Component Tests
 *
 * Validates: back/forward buttons with disabled states (NAV-01, NAV-03),
 * file path breadcrumb rendering (PATH-01, PATH-02, PATH-04).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { KBNavBar } from "../KBNavBar";
import { KBFileBreadcrumb } from "../KBFileBreadcrumb";
import type { KBDocDetail } from "@/types/kb";
import { makeSource } from "./helpers";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock the store
const mockNavigateBack = vi.fn();
const mockNavigateForward = vi.fn();
let mockNavStack: Array<{ docId: string; title: string }> = [];
let mockNavCursor = -1;

vi.mock("@/stores/kbStore", () => ({
  useKBStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      navStack: mockNavStack,
      navCursor: mockNavCursor,
      navigateBack: mockNavigateBack,
      navigateForward: mockNavigateForward,
      editModes: {},
      editBuffers: {},
      docCache: {},
      saveDoc: vi.fn(),
      setEditMode: vi.fn(),
    }),
}));

function makeDocDetail(
  overrides?: Partial<KBDocDetail>,
): KBDocDetail {
  return {
    id: "doc-1",
    source_id: "source-1",
    title: "nmap-cheatsheet",
    relative_path: "notes/recon/nmap-cheatsheet.md",
    tags: null,
    content_hash: null,
    wikilinks: null,
    frontmatter: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    body: "# Nmap Cheatsheet",
    backlinks: [],
    source: makeSource({ name: "My Vault" }),
    ...overrides,
  };
}

describe("KBNavBar", () => {
  beforeEach(() => {
    mockNavigateBack.mockClear();
    mockNavigateForward.mockClear();
    mockNavStack = [];
    mockNavCursor = -1;
  });

  it("renders back and forward buttons", () => {
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={null} />
      </TooltipProvider>,
    );
    const backBtn = container.querySelector('[aria-label="Go back"]');
    const fwdBtn = container.querySelector('[aria-label="Go forward"]');
    expect(backBtn).toBeTruthy();
    expect(fwdBtn).toBeTruthy();
  });

  it("back button is disabled when navCursor is 0", () => {
    mockNavStack = [{ docId: "doc-1", title: "First" }];
    mockNavCursor = 0;
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={null} />
      </TooltipProvider>,
    );
    const backBtn = container.querySelector('[aria-label="Go back"]') as HTMLButtonElement;
    expect(backBtn.disabled).toBe(true);
  });

  it("back button is disabled when navStack is empty", () => {
    mockNavStack = [];
    mockNavCursor = -1;
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={null} />
      </TooltipProvider>,
    );
    const backBtn = container.querySelector('[aria-label="Go back"]') as HTMLButtonElement;
    expect(backBtn.disabled).toBe(true);
  });

  it("forward button is disabled when navCursor is at last index", () => {
    mockNavStack = [
      { docId: "doc-1", title: "First" },
      { docId: "doc-2", title: "Second" },
    ];
    mockNavCursor = 1;
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={null} />
      </TooltipProvider>,
    );
    const fwdBtn = container.querySelector('[aria-label="Go forward"]') as HTMLButtonElement;
    expect(fwdBtn.disabled).toBe(true);
  });

  it("back button is enabled when navCursor > 0", () => {
    mockNavStack = [
      { docId: "doc-1", title: "First" },
      { docId: "doc-2", title: "Second" },
    ];
    mockNavCursor = 1;
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={null} />
      </TooltipProvider>,
    );
    const backBtn = container.querySelector('[aria-label="Go back"]') as HTMLButtonElement;
    expect(backBtn.disabled).toBe(false);
  });

  it("forward button is enabled when navCursor < last index", () => {
    mockNavStack = [
      { docId: "doc-1", title: "First" },
      { docId: "doc-2", title: "Second" },
    ];
    mockNavCursor = 0;
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={null} />
      </TooltipProvider>,
    );
    const fwdBtn = container.querySelector('[aria-label="Go forward"]') as HTMLButtonElement;
    expect(fwdBtn.disabled).toBe(false);
  });

  it("calls navigateBack when back button clicked", () => {
    mockNavStack = [
      { docId: "doc-1", title: "First" },
      { docId: "doc-2", title: "Second" },
    ];
    mockNavCursor = 1;
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={null} />
      </TooltipProvider>,
    );
    const backBtn = container.querySelector('[aria-label="Go back"]') as HTMLButtonElement;
    fireEvent.click(backBtn);
    expect(mockNavigateBack).toHaveBeenCalledOnce();
  });

  it("calls navigateForward when forward button clicked", () => {
    mockNavStack = [
      { docId: "doc-1", title: "First" },
      { docId: "doc-2", title: "Second" },
    ];
    mockNavCursor = 0;
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={null} />
      </TooltipProvider>,
    );
    const fwdBtn = container.querySelector('[aria-label="Go forward"]') as HTMLButtonElement;
    fireEvent.click(fwdBtn);
    expect(mockNavigateForward).toHaveBeenCalledOnce();
  });

  it("renders file breadcrumb when doc is provided", () => {
    const doc = makeDocDetail();
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={doc} />
      </TooltipProvider>,
    );
    const breadcrumb = container.querySelector('[aria-label="File path"]');
    expect(breadcrumb).toBeTruthy();
  });

  it("does not render file breadcrumb when doc is null", () => {
    const { container } = render(
      <TooltipProvider>
        <KBNavBar doc={null} />
      </TooltipProvider>,
    );
    const breadcrumb = container.querySelector('[aria-label="File path"]');
    expect(breadcrumb).toBeNull();
  });
});

describe("KBFileBreadcrumb", () => {
  it("renders source name as first segment", () => {
    const doc = makeDocDetail();
    const { container } = render(<KBFileBreadcrumb doc={doc} />);
    const nav = container.querySelector('[aria-label="File path"]');
    expect(nav).toBeTruthy();
    // First text segment should be source name
    const spans = nav!.querySelectorAll("span > span");
    expect(spans[0]?.textContent).toBe("My Vault");
  });

  it("renders folder segments and filename from relative_path", () => {
    const doc = makeDocDetail({
      relative_path: "notes/recon/nmap-cheatsheet.md",
    });
    const { container } = render(<KBFileBreadcrumb doc={doc} />);
    const text = container.textContent;
    expect(text).toContain("My Vault");
    expect(text).toContain("notes");
    expect(text).toContain("recon");
    expect(text).toContain("nmap-cheatsheet.md");
  });

  it("renders chevron separators between segments", () => {
    const doc = makeDocDetail({
      relative_path: "notes/recon/nmap-cheatsheet.md",
    });
    const { container } = render(<KBFileBreadcrumb doc={doc} />);
    // 4 segments: My Vault > notes > recon > nmap-cheatsheet.md = 3 chevrons
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(3);
  });

  it("last segment (filename) has text-slate-200 class", () => {
    const doc = makeDocDetail({
      relative_path: "notes/nmap.md",
    });
    const { container } = render(<KBFileBreadcrumb doc={doc} />);
    const spans = container.querySelectorAll("span > span");
    const lastSpan = spans[spans.length - 1];
    expect(lastSpan?.className).toContain("text-slate-200");
    expect(lastSpan?.textContent).toBe("nmap.md");
  });

  it("non-last segments have text-slate-500 class", () => {
    const doc = makeDocDetail({
      relative_path: "notes/recon/nmap.md",
    });
    const { container } = render(<KBFileBreadcrumb doc={doc} />);
    const spans = container.querySelectorAll("span > span");
    // First two spans (My Vault, notes) should be slate-500
    expect(spans[0]?.className).toContain("text-slate-500");
    expect(spans[1]?.className).toContain("text-slate-500");
  });

  it("handles deeply nested paths without layout break", () => {
    const doc = makeDocDetail({
      relative_path: "level1/level2/level3/level4/level5/level6/deep-document.md",
    });
    const { container } = render(<KBFileBreadcrumb doc={doc} />);
    const nav = container.querySelector('[aria-label="File path"]');
    expect(nav).toBeTruthy();
    // Should have overflow handling
    expect(nav?.className).toContain("overflow-x-auto");
    expect(nav?.className).toContain("min-w-0");
    // All segments rendered
    const text = container.textContent;
    expect(text).toContain("My Vault");
    expect(text).toContain("level6");
    expect(text).toContain("deep-document.md");
  });

  it("uses 'Source' as fallback when doc.source is missing", () => {
    const doc = makeDocDetail();
    // Force source to undefined-ish
    (doc as Record<string, unknown>).source = undefined;
    const { container } = render(<KBFileBreadcrumb doc={doc} />);
    const spans = container.querySelectorAll("span > span");
    expect(spans[0]?.textContent).toBe("Source");
  });

  it("each segment has a title attribute for tooltip", () => {
    const doc = makeDocDetail({
      relative_path: "notes/nmap.md",
    });
    const { container } = render(<KBFileBreadcrumb doc={doc} />);
    const spans = container.querySelectorAll("span > span");
    for (const span of Array.from(spans)) {
      expect(span.getAttribute("title")).toBeTruthy();
    }
  });
});
