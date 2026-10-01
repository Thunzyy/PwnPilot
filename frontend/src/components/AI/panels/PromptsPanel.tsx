import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Search,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Globe,
  Network,
  ArrowUp,
  Server,
  Cloud,
  Smartphone,
  Target,
  FileText,
  Flag,
  Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiApi } from "@/api/ai";
import type { CategoryGroup, PromptTemplate, PromptTemplateCreate } from "@/types/ai";

const EMPTY_CATEGORY_GROUPS: CategoryGroup[] = [];

// Category icons mapping
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  general: Folder,
  recon: Crosshair,
  web: Globe,
  network: Network,
  privesc: ArrowUp,
  ad: Server,
  cloud: Cloud,
  mobile: Smartphone,
  post: Target,
  reporting: FileText,
  ctf: Flag,
};

interface PromptsPanelProps {
  onInsert?: (text: string) => void;
  onInsertWithVariables?: (template: PromptTemplate) => void;
}

export function PromptsPanel({ onInsert, onInsertWithVariables }: PromptsPanelProps) {
  const queryClient = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [newPrompt, setNewPrompt] = useState<PromptTemplateCreate>({
    type: "template",
    name: "",
    description: "",
    category: "general",
    variables: [],
    content: "",
  });
  const queryKey = ["ai", "prompt-templates"] as const;
  const templatesQuery = useQuery({
    queryKey,
    queryFn: () => aiApi.listTemplatesByCategory(),
  });
  const categories = templatesQuery.data?.categories ?? EMPTY_CATEGORY_GROUPS;
  const normalizedSearch = search.trim().toLowerCase();

  const filteredCategories = categories
    .map((cat) => ({
      ...cat,
      templates: cat.templates.filter(
        (t) =>
          t.name.toLowerCase().includes(normalizedSearch) ||
          t.content.toLowerCase().includes(normalizedSearch) ||
          (t.description &&
            t.description.toLowerCase().includes(normalizedSearch))
      ),
    }))
    .filter((cat) => cat.templates.length > 0);

  const effectiveExpandedCategories = useMemo(() => {
    if (normalizedSearch) {
      return new Set(filteredCategories.map((category) => category.id));
    }
    if (expandedCategories.size > 0) return expandedCategories;
    return categories.length > 0 ? new Set([categories[0].id]) : new Set<string>();
  }, [categories, expandedCategories, filteredCategories, normalizedSearch]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((current) => {
      const prev = current.size > 0
        ? current
        : categories.length > 0
          ? new Set([categories[0].id])
          : new Set<string>();
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!newPrompt.name.trim() || !newPrompt.content.trim()) return;
    try {
      await aiApi.createPrompt(newPrompt);
      setNewPrompt({
        type: "template",
        name: "",
        description: "",
        category: "general",
        variables: [],
        content: "",
      });
      setIsAdding(false);
      await queryClient.invalidateQueries({ queryKey });
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await aiApi.deletePrompt(id);
      await queryClient.invalidateQueries({ queryKey });
    } catch {
      /* ignore */
    }
  };

  const handleInsert = (template: PromptTemplate) => {
    // If template has variables, open the variable modal
    if (template.variables && template.variables.length > 0 && onInsertWithVariables) {
      onInsertWithVariables(template);
    } else if (onInsert) {
      onInsert(template.content);
    }
  };

  return (
    <div className="space-y-3 p-1">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="h-7 text-xs bg-white/[0.03] border-white/10 pl-7"
        />
      </div>

      {/* Categories */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {filteredCategories.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.id] || Folder;
          const isExpanded = effectiveExpandedCategories.has(cat.id);

          return (
            <div key={cat.id} className="rounded-lg border border-white/5 overflow-hidden">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(cat.id)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-slate-400" />
                )}
                <Icon className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-slate-200 flex-1 text-left">
                  {cat.name}
                </span>
                <span className="text-[10px] text-slate-500">{cat.templates.length}</span>
              </button>

              {/* Category Templates */}
              {isExpanded && (
                <div className="border-t border-white/5">
                  {cat.templates.map((t) => (
                    <div
                      key={t.id}
                      className="group px-3 py-2 hover:bg-white/[0.02] border-b border-white/5 last:border-b-0"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-200 truncate">
                              {t.name}
                            </span>
                            {t.variables.length > 0 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                                {t.variables.length} var{t.variables.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          {t.description && (
                            <p className="text-[10px] text-slate-500 truncate mt-0.5">
                              {t.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleInsert(t)}
                            className="p-1 text-primary hover:bg-primary/10 rounded"
                            title="Insert into chat"
                          >
                            <ArrowRight className="h-3 w-3" />
                          </button>
                          {t.is_user_created && (
                            <button
                              onClick={() => handleDelete(t.id)}
                              className="p-1 text-red-400 hover:bg-red-400/10 rounded"
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {filteredCategories.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-4">No templates found</p>
        )}
      </div>

      {/* Add New Template */}
      {isAdding ? (
        <div className="space-y-2 p-2 rounded-lg border border-white/10 bg-white/[0.02]">
          <Input
            value={newPrompt.name}
            onChange={(e) => setNewPrompt((p) => ({ ...p, name: e.target.value }))}
            placeholder="Template name"
            className="h-7 text-xs bg-white/[0.03] border-white/10"
          />
          <Input
            value={newPrompt.description || ""}
            onChange={(e) => setNewPrompt((p) => ({ ...p, description: e.target.value }))}
            placeholder="Description (optional)"
            className="h-7 text-xs bg-white/[0.03] border-white/10"
          />
          <select
            value={newPrompt.category}
            onChange={(e) => setNewPrompt((p) => ({ ...p, category: e.target.value }))}
            className="w-full h-7 text-xs bg-white/[0.03] border border-white/10 rounded-md px-2 text-slate-200 focus:outline-none focus:border-primary/50"
          >
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <textarea
            value={newPrompt.content}
            onChange={(e) => setNewPrompt((p) => ({ ...p, content: e.target.value }))}
            placeholder="Template content... Use {variable} or {variable:default} for variables"
            className="w-full bg-white/[0.03] border border-white/10 rounded-md p-2 text-xs text-slate-200 resize-none focus:outline-none focus:border-primary/50 min-h-[80px]"
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] flex-1"
              onClick={() => setIsAdding(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 text-[10px] flex-1 bg-primary"
              onClick={handleCreate}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-7 text-xs text-slate-400 gap-1"
          onClick={() => setIsAdding(true)}
        >
          <Plus className="h-3 w-3" /> New Template
        </Button>
      )}
    </div>
  );
}
