import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Paperclip, X } from "lucide-react";

import { aiApi } from "@/api/ai";
import type { PendingAttachment } from "@/types/ai";

interface FileAttachmentButtonProps {
  attachments: PendingAttachment[];
  onAttachmentsChange: (attachments: PendingAttachment[]) => void;
  maxFiles?: number;
  disabled?: boolean;
}

export function FileAttachmentButton({
  attachments,
  onAttachmentsChange,
  maxFiles = 5,
  disabled = false,
}: FileAttachmentButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const updateItem = (id: string, patch: Partial<PendingAttachment>) => {
    const updated = attachmentsRef.current.map((attachment) =>
      attachment.id === id ? { ...attachment, ...patch } : attachment,
    );
    attachmentsRef.current = updated;
    onAttachmentsChange(updated);
  };

  const handleClick = () => {
    if (attachments.length >= maxFiles) {
      setStatusMessage(
        `Attachment limit reached: maximum ${maxFiles} ${
          maxFiles === 1 ? "file" : "files"
        }.`,
      );
      return;
    }
    setStatusMessage(null);
    inputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const slotsLeft = maxFiles - attachments.length;
    if (slotsLeft <= 0) {
      setStatusMessage(
        `Attachment limit reached: maximum ${maxFiles} ${
          maxFiles === 1 ? "file" : "files"
        }.`,
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const toAdd = files.slice(0, slotsLeft);
    if (files.length > slotsLeft) {
      setStatusMessage(
        `Added ${toAdd.length} ${toAdd.length === 1 ? "file" : "files"}; maximum ${maxFiles} ${
          maxFiles === 1 ? "file" : "files"
        } allowed.`,
      );
    } else {
      setStatusMessage(null);
    }

    const pending: PendingAttachment[] = toAdd.map((file) => ({
      id: crypto.randomUUID(),
      file,
      filename: file.name,
      status: "uploading" as const,
      progress: 0,
    }));

    const updated = [...attachments, ...pending];
    attachmentsRef.current = updated;
    onAttachmentsChange(updated);

    for (const item of pending) {
      aiApi.uploadAttachment(item.file).then(
        (serverAttachment) =>
          updateItem(item.id, { status: "done", progress: 100, serverAttachment }),
        () => {
          setStatusMessage(`Upload failed for ${item.filename}. Remove it and try again.`);
          updateItem(item.id, { status: "error" });
        },
      );
    }

    if (inputRef.current) inputRef.current.value = "";
  };

  const handleRemove = (id: string) => {
    onAttachmentsChange(attachments.filter((a) => a.id !== id));
  };

  return (
    <div className="flex flex-col gap-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-white/5 border border-white/10"
            >
              {att.status === "uploading" && (
                <Loader2 className="h-3 w-3 animate-spin text-slate-400" aria-hidden="true" />
              )}
              {att.status === "error" && (
                <AlertCircle className="h-3 w-3 text-red-400" aria-hidden="true" />
              )}
              <span className={att.status === "error" ? "text-red-400" : "text-slate-300"}>
                {att.filename}
              </span>
              <button
                type="button"
                aria-label={`Remove attachment ${att.filename}`}
                onClick={() => handleRemove(att.id)}
                className="rounded p-0.5 text-slate-500 transition-colors hover:bg-red-400/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/60"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {statusMessage ? (
        <p role="status" className="text-xs text-amber-200">
          {statusMessage}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        aria-label="Choose files to attach"
        className="hidden"
        onChange={handleFileChange}
      />

      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label="Attach files"
        className="size-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-400 flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
        title="Attach files"
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
