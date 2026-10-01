/**
 * InlineTitle -- Large editable document title above content.
 *
 * Shows the filename (without .md) as a heading. In edit mode,
 * clicking the title switches to an input. Enter/blur commits
 * the rename via the backend API. Escape reverts.
 */
import { useEffect, useRef, useState } from "react";

interface InlineTitleProps {
  docId: string;
  title: string;
  isEditing: boolean;
  isReadOnly: boolean;
  onRename: (newTitle: string) => Promise<void>;
}

export function InlineTitle({ docId, title, isEditing, isReadOnly, onRename }: InlineTitleProps) {
  void docId; // Reserved for future keying use

  const [isRenaming, setIsRenaming] = useState(false);
  const [value, setValue] = useState(title);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync value when title changes externally (e.g., after successful rename)
  useEffect(() => setValue(title), [title]);

  // Auto-focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const commitRename = async () => {
    if (isSubmitting) return; // Guard against double-submit
    const trimmed = value.trim();
    if (!trimmed) {
      // Empty title -- revert to original
      setValue(title);
      setIsRenaming(false);
      return;
    }
    if (trimmed === title) {
      // No change
      setIsRenaming(false);
      return;
    }
    setIsSubmitting(true);
    try {
      await onRename(trimmed);
      setIsRenaming(false);
    } catch {
      // Revert on error (toast shown by store action)
      setValue(title);
      setIsRenaming(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    }
    if (e.key === "Escape") {
      setValue(title);
      setIsRenaming(false);
    }
  };

  // Base heading styles -- match Obsidian's large inline title
  const headingClass = "text-2xl font-bold text-slate-100 leading-tight";

  // Read-only: always static text
  if (isReadOnly) {
    return <h1 className={headingClass}>{title}</h1>;
  }

  // Currently renaming: show input
  if (isRenaming) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commitRename}
        onKeyDown={handleKeyDown}
        disabled={isSubmitting}
        className={`${headingClass} w-full bg-transparent border-none outline-none focus:ring-0 p-0`}
        aria-label="Document title"
      />
    );
  }

  // Edit mode but not yet clicked: clickable heading
  if (isEditing) {
    return (
      <h1
        onClick={() => setIsRenaming(true)}
        className={`${headingClass} cursor-text hover:bg-white/[0.03] rounded px-1 -mx-1 transition-colors`}
        title="Click to rename"
      >
        {title}
      </h1>
    );
  }

  // Reading mode: static heading
  return <h1 className={headingClass}>{title}</h1>;
}
