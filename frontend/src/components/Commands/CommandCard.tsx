import { Check, Copy, MoreHorizontal, Pencil, Play, Star, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CommandCardProps {
  id: string;
  name: string;
  category: string;
  command: string;
  description: string | null;
  tags: string[];
  icon?: React.ReactNode;
  onCopy: () => void;
  onRun?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  isSelectable?: boolean;
  isSelected?: boolean;
  onSelectToggle?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function CommandCard({
  id,
  name,
  category,
  command,
  description,
  tags,
  onCopy,
  onRun,
  isFavorite = false,
  onToggleFavorite,
  isSelectable = false,
  isSelected = false,
  onSelectToggle,
  onEdit,
  onDelete,
}: CommandCardProps) {
  const highlightVariables = (cmd: string) => {
    const parts = cmd.split(/(\{[^}]+\}|\$\w+)/g);
    return parts.map((part, idx) => {
      if (part.match(/^\{[^}]+\}$/) || part.match(/^\$\w+$/)) {
        return (
          <span key={idx} className="text-primary font-semibold">
            {part}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  const hasMenu = Boolean(onEdit || onDelete);

  return (
    <div
      data-testid="command-library-card"
      data-command-id={id}
      data-command-name={name}
      className={`group flex flex-col bg-card-dark border rounded-md overflow-hidden transition-colors ${
        isSelected
          ? "border-primary/60 ring-1 ring-primary/30"
          : "border-border-dark hover:border-text-muted"
      }`}
    >
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="text-white font-semibold text-sm">{name}</h3>
            {description && (
              <p className="text-text-muted text-xs mt-1">{description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isSelectable && onSelectToggle && (
              <button
                type="button"
                onClick={onSelectToggle}
                aria-pressed={isSelected}
                aria-label={
                  isSelected
                    ? `Deselect command ${name}`
                    : `Select command ${name}`
                }
                title={isSelected ? "Deselect command" : "Select command"}
                className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border-dark bg-background-dark text-text-muted hover:text-white hover:border-text-muted"
                }`}
              >
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </button>
            )}
            {onToggleFavorite && (
              <button
                type="button"
                onClick={onToggleFavorite}
                aria-pressed={isFavorite}
                title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                className={`flex items-center justify-center rounded border p-1 transition-colors ${
                  isFavorite
                    ? "border-accent-yellow/50 bg-accent-yellow/10 text-accent-yellow"
                    : "border-border-dark bg-background-dark text-text-muted hover:text-white hover:border-text-muted"
                }`}
              >
                <Star
                  className={`h-3.5 w-3.5 ${
                    isFavorite ? "fill-current" : ""
                  }`}
                />
              </button>
            )}
            <span className="bg-primary/10 text-primary text-[10px] font-medium px-2 py-0.5 rounded border border-primary/20">
              {category}
            </span>
            {tags.slice(0, 1).map((tag) => (
              <span
                key={tag}
                className="bg-background-dark text-text-muted text-[10px] font-medium px-2 py-0.5 rounded border border-border-dark"
              >
                {tag}
              </span>
            ))}
            {hasMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Command actions"
                    className="flex h-6 w-6 items-center justify-center rounded border border-border-dark bg-background-dark text-text-muted hover:text-white hover:border-text-muted transition-colors"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-surface-dark border-border-dark text-text-primary">
                  {onEdit && (
                    <DropdownMenuItem onClick={onEdit}>
                      <Pencil className="h-3 w-3" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-danger-text focus:text-danger-text"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className="bg-target-bg border border-border-dark rounded p-3 relative group/code">
          <code className="font-mono text-xs text-amber-400 break-all pr-10 block">
            {highlightVariables(command)}
          </code>
          <button
            type="button"
            onClick={onCopy}
            className="absolute top-2 right-2 p-1 text-text-muted hover:text-white bg-bg-tertiary border border-border-dark rounded hover:bg-surface-highlight transition-all opacity-0 group-hover/code:opacity-100"
            title="Copy Command"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3 bg-background-dark border-t border-border-dark">
        <button
          type="button"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          View Notes
        </button>
        {onRun && (
          <button
            type="button"
            onClick={onRun}
            className="flex items-center gap-1 text-xs font-medium text-white bg-bg-tertiary border border-border-dark hover:bg-surface-highlight hover:border-text-muted rounded px-3 py-1.5 transition-all"
          >
            <Play className="h-3.5 w-3.5" />
            Run Command
          </button>
        )}
      </div>
    </div>
  );
}
