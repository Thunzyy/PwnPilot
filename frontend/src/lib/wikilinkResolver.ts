/**
 * Wikilink resolution utility.
 *
 * Builds a stem-based lookup from the KB tree and resolves wikilink targets
 * to document IDs. Handles single-match, multi-match (with same-directory
 * preference), and broken links (returns null).
 */
import type { KBTreeDocItem, KBTreeNode } from "@/types/kb";

/**
 * Extract the lowercase filename stem from a relative path.
 * Example: "tools/recon/nmap.md" -> "nmap"
 */
function getStem(relativePath: string): string {
  const filename = relativePath.split("/").pop() ?? relativePath;
  return filename.replace(/\.md$/i, "").toLowerCase();
}

/**
 * Get the directory prefix from a relative path.
 * Example: "tools/recon/nmap.md" -> "tools/recon"
 */
function getDirPrefix(relativePath: string): string {
  const lastSlash = relativePath.lastIndexOf("/");
  return lastSlash === -1 ? "" : relativePath.slice(0, lastSlash);
}

/**
 * Recursively walk the tree and collect all doc items keyed by lowercase stem.
 * Multiple docs can share the same stem (e.g. "tools/nmap.md" and "notes/nmap.md").
 */
export function buildDocLookup(
  tree: KBTreeNode,
): Map<string, KBTreeDocItem[]> {
  const lookup = new Map<string, KBTreeDocItem[]>();

  function walk(node: KBTreeNode): void {
    for (const doc of node.docs) {
      const stem = getStem(doc.relative_path);
      const existing = lookup.get(stem);
      if (existing) {
        existing.push(doc);
      } else {
        lookup.set(stem, [doc]);
      }
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree);
  return lookup;
}

/**
 * Resolve a wikilink target to a document ID.
 *
 * @param target - The wikilink target text (e.g. "nmap", "nmap.md")
 * @param docLookup - Stem-to-doc lookup from buildDocLookup
 * @param currentPath - The relative_path of the current document (for same-dir preference)
 * @returns Document ID if found, null for broken links
 */
export function resolveWikilink(
  target: string,
  docLookup: Map<string, KBTreeDocItem[]>,
  currentPath?: string,
): string | null {
  // Normalize: lowercase, strip .md extension
  const normalized = target.toLowerCase().replace(/\.md$/i, "");
  // Use the last path segment as the stem for lookup
  const stem = normalized.split("/").pop() ?? normalized;

  const candidates = docLookup.get(stem);
  if (!candidates || candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0].id;
  }

  // Multiple matches: prefer same directory as current document
  if (currentPath) {
    const currentDir = getDirPrefix(currentPath);
    const sameDir = candidates.find(
      (c) => getDirPrefix(c.relative_path) === currentDir,
    );
    if (sameDir) {
      return sameDir.id;
    }
  }

  // Fallback: alphabetically first by relative_path
  const sorted = [...candidates].sort((a, b) =>
    a.relative_path.localeCompare(b.relative_path),
  );
  return sorted[0].id;
}
