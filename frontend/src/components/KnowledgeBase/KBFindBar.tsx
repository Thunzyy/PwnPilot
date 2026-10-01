/**
 * KBFindBar -- Obsidian-style find bar for Reading view.
 *
 * Searches rendered markdown content via DOM TreeWalker, highlights matches,
 * and provides prev/next navigation with scroll-into-view.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

interface KBFindBarProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

/** Remove all <mark> highlight elements, restoring original text nodes. */
function clearHighlights(container: HTMLElement) {
  const marks = container.querySelectorAll("mark.find-highlight");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    const text = document.createTextNode(mark.textContent ?? "");
    parent.replaceChild(text, mark);
    parent.normalize();
  });
}

/** Walk text nodes and wrap matches in <mark> elements. Returns array of marks. */
function highlightMatches(
  container: HTMLElement,
  query: string,
): HTMLElement[] {
  const marks: HTMLElement[] = [];
  if (!query) return marks;

  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
  );

  // Collect text nodes first (mutating DOM while walking is unsafe)
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    const lowerText = text.toLowerCase();
    let startIdx = 0;
    const indices: number[] = [];

     
    while (true) {
      const idx = lowerText.indexOf(lowerQuery, startIdx);
      if (idx === -1) break;
      indices.push(idx);
      startIdx = idx + lowerQuery.length;
    }

    if (indices.length === 0) continue;

    const parent = textNode.parentNode;
    if (!parent) continue;

    // Build replacement fragment
    const frag = document.createDocumentFragment();
    let lastEnd = 0;

    for (const idx of indices) {
      if (idx > lastEnd) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd, idx)));
      }
      const mark = document.createElement("mark");
      mark.className = "find-highlight";
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      marks.push(mark);
      lastEnd = idx + query.length;
    }

    if (lastEnd < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastEnd)));
    }

    parent.replaceChild(frag, textNode);
  }

  return marks;
}

export function KBFindBar({ containerRef, onClose }: KBFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const marksRef = useRef<HTMLElement[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Cleanup highlights on unmount
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      if (container) clearHighlights(container);
    };
  }, [containerRef]);

  // Run search when query changes (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;

      clearHighlights(container);

      if (!query.trim()) {
        marksRef.current = [];
        setMatchCount(0);
        setCurrentIndex(0);
        return;
      }

      const marks = highlightMatches(container, query);
      marksRef.current = marks;
      setMatchCount(marks.length);

      if (marks.length > 0) {
        setCurrentIndex(0);
        marks[0].classList.add("find-highlight-current");
        marks[0].scrollIntoView({ block: "center", behavior: "smooth" });
      } else {
        setCurrentIndex(0);
      }
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, containerRef]);

  const goToMatch = useCallback(
    (index: number) => {
      const marks = marksRef.current;
      if (marks.length === 0) return;

      // Remove current highlight
      marks[currentIndex]?.classList.remove("find-highlight-current");

      // Wrap index
      const next = ((index % marks.length) + marks.length) % marks.length;
      setCurrentIndex(next);

      marks[next].classList.add("find-highlight-current");
      marks[next].scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [currentIndex],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        goToMatch(currentIndex - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        goToMatch(currentIndex + 1);
      }
    },
    [onClose, goToMatch, currentIndex],
  );

  return (
    <div className="flex items-center gap-2 justify-center">
      {/* Bordered input box with search icon inside */}
      <div className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-bg-secondary px-3">
        <Search className="h-4 w-4 shrink-0 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find..."
          className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
        {query && matchCount > 0 && (
          <span className="shrink-0 text-xs text-text-muted">
            {currentIndex + 1} of {matchCount}
          </span>
        )}
        {query && matchCount === 0 && (
          <span className="shrink-0 text-xs text-text-muted">No results</span>
        )}
      </div>

      {/* Navigation buttons outside the input box */}
      <button
        type="button"
        onClick={() => goToMatch(currentIndex - 1)}
        className="rounded p-1 text-text-muted hover:text-text-primary disabled:opacity-30"
        disabled={matchCount === 0}
        aria-label="Previous match"
      >
        <ChevronUp className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => goToMatch(currentIndex + 1)}
        className="rounded p-1 text-text-muted hover:text-text-primary disabled:opacity-30"
        disabled={matchCount === 0}
        aria-label="Next match"
      >
        <ChevronDown className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-1 text-text-muted hover:text-text-primary"
        aria-label="Close find bar"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
