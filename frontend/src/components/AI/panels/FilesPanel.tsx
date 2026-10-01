import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Trash2, FileText, Image, FileCode, File, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiApi } from "@/api/ai";
import type { Attachment } from "@/types/ai";

const FILE_ICONS: Record<string, typeof FileText> = {
  text: FileText,
  image: Image,
  code: FileCode,
};

function getIcon(contentType: string) {
  if (contentType.startsWith("image/")) return FILE_ICONS.image;
  if (contentType.includes("json") || contentType.includes("javascript") || contentType.includes("python") || contentType.includes("xml"))
    return FILE_ICONS.code;
  if (contentType.startsWith("text/")) return FILE_ICONS.text;
  return File;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchPanelFiles(projectId: string | null) {
  const conversations = await aiApi.listConversations(projectId ?? "__global__");
  const allFiles: Attachment[] = [];
  const seen = new Set<string>();

  for (const conversation of conversations.slice(0, 10)) {
    try {
      const detail = await aiApi.getConversation(conversation.id);
      for (const message of detail.messages) {
        for (const attachment of message.attachments ?? []) {
          if (seen.has(attachment.id)) continue;
          seen.add(attachment.id);
          allFiles.push(attachment);
        }
      }
    } catch {
      // Ignore conversations that fail to load.
    }
  }

  return allFiles;
}

export function FilesPanel({ projectId }: { projectId: string | null }) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryKey = ["ai", "panel-files", projectId] as const;
  const filesQuery = useQuery({
    queryKey,
    queryFn: () => fetchPanelFiles(projectId),
  });
  const files = filesQuery.data ?? [];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    if (!fileList.length) return;
    setUploading(true);
    try {
      for (const file of fileList) {
        const att = await aiApi.uploadAttachment(file);
        queryClient.setQueryData<Attachment[]>(queryKey, (current = []) => [att, ...current]);
      }
    } catch { /* ignore */ }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDelete = async (id: string) => {
    try {
      await aiApi.deleteAttachment(id);
      queryClient.setQueryData<Attachment[]>(
        queryKey,
        (current = []) => current.filter((file) => file.id !== id)
      );
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-3 p-1">
      <p className="text-[10px] text-slate-500">
        Files attached to conversations in this project.
      </p>

      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {files.map((file) => {
          const Icon = getIcon(file.content_type);
          return (
            <div key={file.id} className="group flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/5 hover:border-primary/20 transition-colors">
              <Icon className="h-4 w-4 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-200 truncate">{file.filename}</p>
                <p className="text-[10px] text-slate-500">{formatBytes(file.size_bytes)}</p>
              </div>
              <button onClick={() => handleDelete(file.id)} className="p-1 text-red-400 hover:bg-red-400/10 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {files.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-4">No files yet</p>
        )}
      </div>

      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleUpload} />
      <Button
        variant="ghost"
        size="sm"
        className="w-full h-7 text-xs text-slate-400 gap-1"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
        {uploading ? "Uploading..." : "Upload File"}
      </Button>
    </div>
  );
}
