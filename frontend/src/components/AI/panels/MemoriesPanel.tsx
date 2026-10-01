import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiApi } from "@/api/ai";
import type { AIMemory } from "@/types/ai";

export function MemoriesPanel({ projectId }: { projectId: string | null }) {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const queryKey = useMemo(() => ["ai", "memories", projectId] as const, [projectId]);
  const memoriesQuery = useQuery({
    queryKey,
    queryFn: () => aiApi.listMemories(projectId),
  });
  const memories = memoriesQuery.data ?? [];

  const handleCreate = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    try {
      await aiApi.createMemory({ project_id: projectId, key: newKey.trim(), value: newValue.trim() });
      setNewKey("");
      setNewValue("");
      setIsAdding(false);
      await queryClient.invalidateQueries({ queryKey });
    } catch { /* ignore */ }
  };

  const handleUpdate = async (id: string) => {
    if (!editValue.trim()) return;
    try {
      await aiApi.updateMemory(id, { value: editValue.trim() });
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey });
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    try {
      await aiApi.deleteMemory(id);
      queryClient.setQueryData<AIMemory[]>(
        queryKey,
        (current = []) => current.filter((memory) => memory.id !== id)
      );
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-3 p-1">
      <p className="text-[10px] text-slate-500">
        Facts the AI remembers across conversations in this project.
      </p>

      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {memories.map((mem) => (
          <div key={mem.id} className="group p-2 rounded-lg bg-white/[0.02] border border-white/5 hover:border-primary/20 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">{mem.key}</span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {editingId === mem.id ? (
                  <>
                    <button onClick={() => handleUpdate(mem.id)} className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded"><Check className="h-3 w-3" /></button>
                    <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-white/10 rounded"><X className="h-3 w-3" /></button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditingId(mem.id); setEditValue(mem.value); }} className="p-1 text-slate-400 hover:bg-white/10 rounded"><Pencil className="h-3 w-3" /></button>
                    <button onClick={() => handleDelete(mem.id)} className="p-1 text-red-400 hover:bg-red-400/10 rounded"><Trash2 className="h-3 w-3" /></button>
                  </>
                )}
              </div>
            </div>
            {editingId === mem.id ? (
              <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-7 text-xs bg-white/[0.03] border-white/10" onKeyDown={(e) => { if (e.key === "Enter") handleUpdate(mem.id); if (e.key === "Escape") setEditingId(null); }} autoFocus />
            ) : (
              <p className="text-xs text-slate-300">{mem.value}</p>
            )}
          </div>
        ))}
        {memories.length === 0 && !isAdding && (
          <p className="text-xs text-slate-500 text-center py-4">No memories yet</p>
        )}
      </div>

      {isAdding ? (
        <div className="space-y-2 p-2 rounded-lg border border-white/10 bg-white/[0.02]">
          <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="Key (e.g. target_os)" className="h-7 text-xs bg-white/[0.03] border-white/10" />
          <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Value (e.g. Windows Server 2019)" className="h-7 text-xs bg-white/[0.03] border-white/10" />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="h-6 text-[10px] flex-1" onClick={() => setIsAdding(false)}>Cancel</Button>
            <Button size="sm" className="h-6 text-[10px] flex-1 bg-primary" onClick={handleCreate}>Save</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="w-full h-7 text-xs text-slate-400 gap-1" onClick={() => setIsAdding(true)}>
          <Plus className="h-3 w-3" /> Add Memory
        </Button>
      )}
    </div>
  );
}
