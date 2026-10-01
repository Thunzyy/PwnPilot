/**
 * CM6 Facet definitions for injecting callbacks from React into
 * the Live Preview extension.
 *
 * Facets allow the pure-JS CM6 plugin to receive React-scoped
 * functions (wikilink resolver, navigator, link opener) without
 * tight coupling. Each facet uses last-wins combine semantics.
 */
import { Facet } from "@codemirror/state";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Resolves a wikilink target to a document ID, or null for broken links. */
export type WikilinkResolver = (target: string) => string | null;

/** Navigates to a wikilink target (e.g. opens the document). */
export type WikilinkNavigator = (target: string) => void;

/** Opens an external URL (e.g. from a standard markdown link). */
export type LinkOpener = (url: string) => void;

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

/**
 * Facet for wikilink resolution. The resolver receives a target string
 * (e.g. "nmap") and returns the document ID if found, or null.
 *
 * Default: always returns null (all wikilinks render as broken).
 */
export const wikilinkResolverFacet = Facet.define<
  WikilinkResolver,
  WikilinkResolver
>({
  combine: (values) => values[values.length - 1] ?? (() => null),
});

/**
 * Facet for wikilink navigation. Called when a user clicks a wikilink.
 *
 * Default: no-op.
 */
export const wikilinkNavigatorFacet = Facet.define<
  WikilinkNavigator,
  WikilinkNavigator
>({
  combine: (values) => values[values.length - 1] ?? (() => {}),
});

/**
 * Facet for opening external links. Called when a user Ctrl+Clicks
 * a standard markdown link.
 *
 * Default: opens in a new tab via window.open.
 */
export const linkOpenerFacet = Facet.define<LinkOpener, LinkOpener>({
  combine: (values) =>
    values[values.length - 1] ??
    ((url: string) => window.open(url, "_blank")),
});
