import { useEffect, useState } from "react";
import { Tags } from "lucide-react";
import { kbApi } from "@/api/kb";
import type { KBTagInfo } from "@/types/kb";
import { cn } from "@/lib/utils";

interface TagsSectionProps {
  activeTag: string | null;
  onTagClick: (tag: string) => void;
}

export function TagsSection({ activeTag, onTagClick }: TagsSectionProps) {
  const [tags, setTags] = useState<KBTagInfo[]>([]);

  useEffect(() => {
    kbApi.getTags().then(setTags).catch(() => {});
  }, []);

  if (tags.length === 0) return null;

  return (
    <div className="mb-1">
      <h3 className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
        <Tags className="h-3 w-3" />
        Tags
      </h3>
      <div className="flex flex-wrap gap-1.5 px-3 py-1">
        {tags.map((t) => (
          <button
            key={t.tag}
            type="button"
            onClick={() => onTagClick(t.tag)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium transition-colors cursor-pointer",
              activeTag === t.tag
                ? "bg-primary/25 text-primary ring-1 ring-primary/50"
                : "bg-primary/15 text-primary hover:bg-primary/25",
            )}
          >
            {t.tag}
            <span className="text-primary/50">{t.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
