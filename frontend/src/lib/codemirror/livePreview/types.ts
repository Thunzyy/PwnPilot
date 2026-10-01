/**
 * Shared types for the Live Preview decoration system.
 *
 * DecorationRange is used to collect decoration ranges before
 * passing them to RangeSet.of() with auto-sorting enabled.
 */
import type { Decoration } from "@codemirror/view";

/** A collected decoration range before sorting and finalization. */
export type DecorationRange = {
  from: number;
  to: number;
  decoration: Decoration;
};
