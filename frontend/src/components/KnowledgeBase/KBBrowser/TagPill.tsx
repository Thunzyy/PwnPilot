/**
 * TagPill -- Renders a single tag as a styled pill/badge.
 *
 * Supports two sizes:
 * - "sm" for sidebar tree nodes (compact, 10px text)
 * - "md" for document viewer and properties (standard, xs text)
 *
 * When onClick is provided, the pill is a clickable button.
 * When onClick is omitted, it renders as a passive span.
 */
import { cn } from "@/lib/utils";

interface TagPillProps {
  tag: string;
  size?: "sm" | "md";
  onClick?: (tag: string) => void;
  className?: string;
}

export function TagPill({ tag, size = "md", onClick, className }: TagPillProps) {
  const sizeClasses =
    size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs";

  const baseClasses = cn(
    "inline-flex items-center rounded-full font-medium",
    "bg-primary/15 text-primary",
    "transition-colors",
    sizeClasses,
    onClick && "hover:bg-primary/25 cursor-pointer",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(tag)}
        className={baseClasses}
      >
        {tag}
      </button>
    );
  }

  return <span className={baseClasses}>{tag}</span>;
}
