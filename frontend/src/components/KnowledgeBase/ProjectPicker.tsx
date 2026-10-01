import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ProjectPicker({
  selectedProjectId,
  onSelect,
}: {
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
}) {
  const { projects, fetchProjects } = useProjectStore();

  useEffect(() => {
    if (projects.length === 0) {
      fetchProjects();
    }
  }, [projects.length, fetchProjects]);

  const selected = projects.find((p) => p.id === selectedProjectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between text-sm font-normal"
        >
          {selected?.name ?? "Select project"}
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => onSelect(project.id)}
          >
            {project.name}
          </DropdownMenuItem>
        ))}
        {projects.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No projects found
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
