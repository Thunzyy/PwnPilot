import { Paperclip } from 'lucide-react';
import { aiApi } from '@/api/ai';
import type { Attachment } from '@/types/ai';

interface AttachmentPreviewProps {
  attachments: Attachment[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPreview({ attachments }: AttachmentPreviewProps) {
  if (!attachments.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachments.map((att) => {
        const url = aiApi.getAttachmentUrl(att.id);
        const isImage = att.content_type.startsWith('image/');

        if (isImage) {
          return (
            <a key={att.id} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt={att.filename}
                className="max-w-[200px] rounded-lg border border-white/10 cursor-pointer hover:opacity-80 transition-opacity"
              />
            </a>
          );
        }

        return (
          <a
            key={att.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Paperclip className="h-3 w-3" />
            {att.filename} ({formatSize(att.size_bytes)})
          </a>
        );
      })}
    </div>
  );
}
