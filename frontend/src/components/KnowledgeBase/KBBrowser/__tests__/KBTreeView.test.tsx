/**
 * KBTreeView Component Tests (NAV-01)
 *
 * Validates tree rendering: folder hierarchy, folder-before-file sort,
 * file click -> onSelectDoc, folder toggle, active document highlight,
 * empty/loading states.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { KBTreeView } from "../KBTreeView";
import { makeSampleTree, makeTreeNode } from "./helpers";

describe("KBTreeView", () => {
  const defaultProps = {
    tree: makeSampleTree(),
    activeDocId: null,
    expandedFolders: ["recon", "tools"],
    isLoading: false,
    onToggleFolder: vi.fn(),
    onSelectDoc: vi.fn(),
  };

  it("renders folder hierarchy with correct nesting", () => {
    const { container } = render(<KBTreeView {...defaultProps} />);

    // Should have a tree nav with role="tree"
    const treeEl = container.querySelector('[role="tree"]');
    expect(treeEl).toBeTruthy();

    // Folder names visible
    expect(container.textContent).toContain("recon");
    expect(container.textContent).toContain("tools");
  });

  it("renders folders sorted before files at root level", () => {
    const { container } = render(<KBTreeView {...defaultProps} />);

    // KBTreeView renders children (folders) before docs (files)
    // The root has: children=[recon, tools], docs=[notes]
    const allItems = container.querySelectorAll('[role="treeitem"]');
    expect(allItems.length).toBeGreaterThan(0);

    // First treeitem should be a folder (recon or tools), not the file (notes)
    // Folders are rendered by KBTreeNode which includes folder icon
    const firstItem = allItems[0];
    expect(firstItem).toBeTruthy();
    // "notes" should appear after folders
    const textItems = Array.from(allItems).map((el) => el.textContent?.trim());
    const notesIdx = textItems.findIndex((t) => t?.includes("notes"));
    const reconIdx = textItems.findIndex((t) => t?.includes("recon"));
    expect(reconIdx).toBeLessThan(notesIdx);
  });

  it("calls onSelectDoc when clicking a file", () => {
    const onSelectDoc = vi.fn();
    const { container } = render(
      <KBTreeView {...defaultProps} onSelectDoc={onSelectDoc} />,
    );

    // Root-level file "notes" should have a clickable button
    const buttons = container.querySelectorAll("button");
    const notesBtn = Array.from(buttons).find((btn) =>
      btn.textContent?.includes("notes"),
    );
    expect(notesBtn).toBeTruthy();

    fireEvent.click(notesBtn!);
    expect(onSelectDoc).toHaveBeenCalledWith("root-notes", undefined);
  });

  it("calls onToggleFolder when clicking a folder", () => {
    const onToggleFolder = vi.fn();
    const { container } = render(
      <KBTreeView {...defaultProps} onToggleFolder={onToggleFolder} />,
    );

    // Find the folder trigger button for "recon"
    const buttons = container.querySelectorAll("button");
    const reconBtn = Array.from(buttons).find((btn) =>
      btn.textContent?.includes("recon"),
    );
    expect(reconBtn).toBeTruthy();

    fireEvent.click(reconBtn!);
    expect(onToggleFolder).toHaveBeenCalledWith("recon");
  });

  it("highlights active document with selected styling", () => {
    const { container } = render(
      <KBTreeView {...defaultProps} activeDocId="root-notes" />,
    );

    // The active treeitem should have aria-selected=true
    const selected = container.querySelector('[aria-selected="true"]');
    expect(selected).toBeTruthy();
    expect(selected?.textContent).toContain("notes");
  });

  it("shows empty state when tree is empty", () => {
    const emptyTree = makeTreeNode({ name: "", children: [], docs: [] });
    const { container } = render(
      <KBTreeView {...defaultProps} tree={emptyTree} />,
    );

    expect(container.textContent).toContain("No documents");
  });

  it("shows empty state when tree is null", () => {
    const { container } = render(
      <KBTreeView {...defaultProps} tree={null} />,
    );

    expect(container.textContent).toContain("No documents");
  });

  it("shows loading spinner when isLoading is true", () => {
    const { container } = render(
      <KBTreeView {...defaultProps} isLoading={true} />,
    );

    // Loading state should not show tree content
    expect(container.textContent).not.toContain("recon");
    // Loader2 renders an SVG with animate-spin class
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeTruthy();
  });

  it("renders nested files inside expanded folders", () => {
    const { container } = render(<KBTreeView {...defaultProps} />);

    // With recon and tools expanded, their docs should be visible
    expect(container.textContent).toContain("nmap");
    expect(container.textContent).toContain("masscan");
    expect(container.textContent).toContain("burp");
  });

  it("calls onSelectDoc with correct ID for nested file", () => {
    const onSelectDoc = vi.fn();
    const { container } = render(
      <KBTreeView {...defaultProps} onSelectDoc={onSelectDoc} />,
    );

    // Click masscan inside recon folder
    const buttons = container.querySelectorAll("button");
    const masscanBtn = Array.from(buttons).find((btn) =>
      btn.textContent?.includes("masscan"),
    );
    expect(masscanBtn).toBeTruthy();

    fireEvent.click(masscanBtn!);
    expect(onSelectDoc).toHaveBeenCalledWith("recon-masscan", undefined);
  });

  it("renders tag pills next to filenames", () => {
    const { container } = render(<KBTreeView {...defaultProps} />);

    // nmap.md in recon has tags "recon scanning" -- both should render in the row
    const treeItems = container.querySelectorAll('[role="treeitem"]');
    const nmapRow = Array.from(treeItems).find((item) =>
      item.textContent?.includes("nmap"),
    );
    expect(nmapRow).toBeTruthy();
    expect(nmapRow!.textContent).toContain("recon");
    expect(nmapRow!.textContent).toContain("scanning");
  });

  it("does not nest tag buttons inside file action buttons", () => {
    const { container } = render(<KBTreeView {...defaultProps} />);

    const buttons = container.querySelectorAll("button");
    const nmapBtn = Array.from(buttons).find((btn) =>
      btn.textContent?.includes("nmap"),
    );

    expect(nmapBtn).toBeTruthy();
    expect(nmapBtn!.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows +N overflow indicator for docs with many tags", () => {
    const { container } = render(<KBTreeView {...defaultProps} />);

    // masscan.md has 4 tags: "recon scanning privesc lateral"
    // MAX_VISIBLE_TAGS=2, so overflow = +2
    const treeItems = container.querySelectorAll('[role="treeitem"]');
    const masscanRow = Array.from(treeItems).find(
      (item) => item.textContent?.includes("masscan"),
    );
    expect(masscanRow).toBeTruthy();
    expect(masscanRow!.textContent).toContain("+2");
  });

  it("does not render tag pills for docs without tags", () => {
    const { container } = render(<KBTreeView {...defaultProps} />);

    // root-level "notes" doc has no tags -- should not contain any TagPill buttons
    // besides the one for the doc title itself
    const allButtons = container.querySelectorAll("button");
    const notesBtn = Array.from(allButtons).find(
      (btn) => btn.textContent?.includes("notes"),
    );
    expect(notesBtn).toBeTruthy();
    // notes button should only contain the title text, no tag pills
    // TagPill buttons are nested inside the parent button's span wrapper
    const tagPillButtons = notesBtn!.querySelectorAll("button");
    expect(tagPillButtons.length).toBe(0);
  });
});
