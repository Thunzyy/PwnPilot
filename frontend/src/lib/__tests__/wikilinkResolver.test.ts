/**
 * Unit tests for wikilink resolution logic.
 *
 * Proves buildDocLookup builds correct stem-based maps and resolveWikilink
 * handles single match, ambiguous (same-dir preference), alpha fallback,
 * broken links, .md extension, and case-insensitive resolution.
 */
import { describe, it, expect } from "vitest";
import { buildDocLookup, resolveWikilink } from "@/lib/wikilinkResolver";
import { makeSampleTree } from "@/components/KnowledgeBase/KBBrowser/__tests__/helpers";

describe("buildDocLookup", () => {
  it("builds correct stems from tree", () => {
    const tree = makeSampleTree();
    const lookup = buildDocLookup(tree);

    // "nmap" stem should map to 2 items (recon/nmap.md + tools/nmap.md)
    expect(lookup.has("nmap")).toBe(true);
    expect(lookup.get("nmap")?.length).toBe(2);

    // "masscan" stem -> 1 item
    expect(lookup.has("masscan")).toBe(true);
    expect(lookup.get("masscan")?.length).toBe(1);

    // "burp" stem -> 1 item
    expect(lookup.has("burp")).toBe(true);
    expect(lookup.get("burp")?.length).toBe(1);

    // "notes" stem -> 1 item
    expect(lookup.has("notes")).toBe(true);
    expect(lookup.get("notes")?.length).toBe(1);
  });

  it("nmap stem maps to both recon and tools entries", () => {
    const tree = makeSampleTree();
    const lookup = buildDocLookup(tree);
    const nmapEntries = lookup.get("nmap")!;

    const ids = nmapEntries.map((e) => e.id).sort();
    expect(ids).toEqual(["recon-nmap", "tools-nmap"]);
  });
});

describe("resolveWikilink", () => {
  const tree = makeSampleTree();
  const lookup = buildDocLookup(tree);

  it("resolves unique target to doc ID", () => {
    // "masscan" has exactly 1 match
    expect(resolveWikilink("masscan", lookup)).toBe("recon-masscan");
  });

  it("resolves ambiguous target with same-directory preference", () => {
    // "nmap" has 2 matches; current doc is in recon/ -> prefer recon/nmap.md
    const result = resolveWikilink("nmap", lookup, "recon/masscan.md");
    expect(result).toBe("recon-nmap");
  });

  it("falls back to alphabetically first for ambiguous with no same-dir", () => {
    // "nmap" has 2 matches; current doc is root-level (no matching dir)
    const result = resolveWikilink("nmap", lookup, "notes.md");
    // recon/nmap.md comes before tools/nmap.md alphabetically
    expect(result).toBe("recon-nmap");
  });

  it("returns null for unknown target", () => {
    expect(resolveWikilink("nonexistent", lookup)).toBeNull();
  });

  it("handles .md extension in target", () => {
    // "masscan.md" should strip .md and resolve to the stem "masscan"
    expect(resolveWikilink("masscan.md", lookup)).toBe("recon-masscan");
  });

  it("resolves case-insensitively", () => {
    expect(resolveWikilink("MASSCAN", lookup)).toBe("recon-masscan");
    expect(resolveWikilink("Burp", lookup)).toBe("tools-burp");
  });

  it("resolves ambiguous target with same-dir from tools/", () => {
    // Current doc is in tools/ -> prefer tools/nmap.md
    const result = resolveWikilink("nmap", lookup, "tools/burp.md");
    expect(result).toBe("tools-nmap");
  });

  it("resolves without currentPath (no same-dir preference)", () => {
    // "nmap" with no currentPath -> alphabetically first
    const result = resolveWikilink("nmap", lookup);
    expect(result).toBe("recon-nmap");
  });
});
