/**
 * Live Preview extension entry point.
 *
 * Returns a CodeMirror Extension array that provides cursor-aware
 * inline markdown rendering. When the cursor is on a line, raw
 * markdown is shown. When the cursor leaves, decorations hide
 * syntax characters and apply rich formatting.
 *
 * Accepts an optional config for wikilink resolution/navigation
 * and link opening callbacks via Facets.
 *
 * Usage in KBMarkdownEditor:
 *   extensions: [...minimalSetup, markdown(), lineWrapping, livePreview({
 *     resolveWikilink: resolver,
 *     onWikilinkClick: navigator,
 *     onLinkClick: opener,
 *   })]
 */
import type { Extension } from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";
import { livePreviewPlugin } from "./livePreviewPlugin";
import { imagePreviewField } from "./imageField";
import { livePreviewBaseTheme } from "./theme";
import { formattingKeymap } from "./shortcuts";
import {
  wikilinkResolverFacet,
  wikilinkNavigatorFacet,
  linkOpenerFacet,
} from "./facets";
import { toggleTaskCheckbox } from "./decorations/tasks";

/** Configuration for the Live Preview extension. */
export interface LivePreviewConfig {
  /** Resolve a wikilink target to a document ID (null = broken link). */
  resolveWikilink?: (target: string) => string | null;
  /** Navigate to a wikilink target on click. */
  onWikilinkClick?: (target: string) => void;
  /** Open a standard link URL (default: window.open in new tab). */
  onLinkClick?: (url: string) => void;
}

export function livePreview(config?: LivePreviewConfig): Extension {
  const extensions: Extension[] = [
    livePreviewPlugin,
    imagePreviewField, // Block widgets for image previews (separate StateField required for height-changing decorations)
    livePreviewBaseTheme,
    drawSelection(), // MANDATORY: fixes cursor rendering with hidden/replaced text (P3)
    formattingKeymap, // Ctrl+B bold, Ctrl+I italic, Ctrl+K link
  ];

  // Wire up facets from config
  if (config?.resolveWikilink) {
    extensions.push(wikilinkResolverFacet.of(config.resolveWikilink));
  }
  if (config?.onWikilinkClick) {
    extensions.push(wikilinkNavigatorFacet.of(config.onWikilinkClick));
  }
  extensions.push(
    linkOpenerFacet.of(
      config?.onLinkClick ?? ((url: string) => window.open(url, "_blank")),
    ),
  );

  // Click handler for links and wikilinks
  extensions.push(
    EditorView.domEventHandlers({
      mousedown(event: MouseEvent, view) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;

        // Checkbox toggle: prevent browser default and dispatch CM6 transaction
        if (
          target instanceof HTMLInputElement &&
          target.classList.contains("cm-lp-checkbox")
        ) {
          event.preventDefault();
          const pos = view.posAtDOM(target);
          toggleTaskCheckbox(view, pos);
          return true;
        }

        // Must have the link class
        if (!target.classList.contains("cm-lp-link")) return false;

        // Wikilink: click navigates (no modifier needed)
        const wikilinkTarget = target.getAttribute("data-wikilink-target");
        if (wikilinkTarget) {
          view.state.facet(wikilinkNavigatorFacet)(wikilinkTarget);
          event.preventDefault();
          return true;
        }

        // Standard link: Ctrl+Click (or Cmd+Click on Mac) opens URL
        const href = target.getAttribute("data-href");
        if (href && (event.ctrlKey || event.metaKey)) {
          view.state.facet(linkOpenerFacet)(href);
          event.preventDefault();
          return true;
        }

        // No modifier on standard link — let cursor placement happen
        return false;
      },
    }),
  );

  return extensions;
}
