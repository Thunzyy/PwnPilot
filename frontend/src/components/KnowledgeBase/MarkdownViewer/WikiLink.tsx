/**
 * WikiLink -- Inline button styled as a link for wikilink navigation.
 *
 * Renders as a <button> (not <a>) to prevent default browser navigation.
 * Two visual states:
 * - Valid wikilink: primary color with dotted underline
 * - Broken wikilink: muted text with strikethrough, non-interactive
 */
import type { ReactNode } from "react";

interface WikiLinkProps {
  /** The wikilink target (document stem or path). */
  target: string;
  /** Whether this wikilink could not be resolved. */
  isBroken?: boolean;
  /** Callback when the user clicks a valid wikilink. */
  onNavigate?: (target: string) => void;
  /** Display text for the link. */
  children: ReactNode;
}

const validClasses = [
  "text-primary",
  "hover:text-primary/80",
  "underline",
  "decoration-dotted",
  "decoration-primary/40",
  "hover:decoration-primary/70",
  "cursor-pointer",
  "inline",
  "font-inherit",
  "text-inherit",
  "p-0",
  "bg-transparent",
  "border-none",
].join(" ");

const brokenClasses = [
  "text-slate-500",
  "line-through",
  "cursor-not-allowed",
  "decoration-solid",
  "inline",
  "font-inherit",
  "text-inherit",
  "p-0",
  "bg-transparent",
  "border-none",
].join(" ");

export function WikiLink({
  target,
  isBroken = false,
  onNavigate,
  children,
}: WikiLinkProps) {
  const handleClick = () => {
    if (!isBroken && onNavigate) {
      onNavigate(target);
    }
  };

  return (
    <button
      type="button"
      className={isBroken ? brokenClasses : validClasses}
      onClick={handleClick}
      aria-disabled={isBroken}
      title={isBroken ? `Broken link: ${target}` : target}
    >
      {children}
    </button>
  );
}
