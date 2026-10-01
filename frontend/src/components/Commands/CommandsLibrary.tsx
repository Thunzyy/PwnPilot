import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ListChecks, Search, Star } from "lucide-react";

import { commandsApi, type Command } from "@/api/commands";
import { CommandCard } from "./CommandCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CommandsLibraryProps {
  variables: Record<string, string | undefined>;
  onCopyCommand: (command: string) => void;
  onRunCommand?: (command: string) => void;
  onAskAI?: (prompt: string) => void;
  scope?: "global" | "project";
  projectId?: string;
  fullPageScroll?: boolean;
}

export function CommandsLibrary({
  variables,
  onCopyCommand,
  onRunCommand,
  onAskAI,
  scope = "global",
  projectId,
  fullPageScroll = false,
}: CommandsLibraryProps) {
  const [projectCommands, setProjectCommands] = useState<Command[]>([]);
  const [globalCommands, setGlobalCommands] = useState<Command[]>([]);
  const [globalFavoriteIds, setGlobalFavoriteIds] = useState<string[]>([]);
  const [projectFavoriteIds, setProjectFavoriteIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [globalFavoritesOnly, setGlobalFavoritesOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editTarget, setEditTarget] = useState<Command | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: "",
    category: "",
    command: "",
    description: "",
    tags: "",
  });
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(
    null
  );
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadCommands = async () => {
      setIsLoading(true);
      try {
        if (scope === "project" && projectId) {
          const [
            projectCommands,
            projectFavorites,
            globalCmds,
            globalFavs,
          ] = await Promise.all([
            commandsApi.listProjectCommands(projectId),
            commandsApi.listProjectFavorites(projectId),
            commandsApi.listGlobalCommands(),
            commandsApi.listGlobalFavorites(),
          ]);

          let seededGlobals = globalCmds;
          if (seededGlobals.length === 0) {
            await commandsApi.seedGlobalCommands();
            seededGlobals = await commandsApi.listGlobalCommands();
          }

          if (!isMounted) return;
          setProjectCommands(projectCommands);
          setProjectFavoriteIds(projectFavorites);
          setGlobalCommands(seededGlobals);
          setGlobalFavoriteIds(globalFavs);
          setIsLoading(false);
          return;
        }

        let globalList = await commandsApi.listGlobalCommands();
        if (globalList.length === 0) {
          await commandsApi.seedGlobalCommands();
          globalList = await commandsApi.listGlobalCommands();
        }
        const favorites = await commandsApi.listGlobalFavorites();

        if (!isMounted) return;
        setProjectCommands([]);
        setGlobalCommands(globalList);
        setGlobalFavoriteIds(favorites);
        setIsLoading(false);
      } catch {
        if (!isMounted) return;
        console.error("Failed to load commands");
        setIsLoading(false);
      }
    };

    loadCommands();
    return () => {
      isMounted = false;
    };
  }, [scope, projectId]);

  useEffect(() => {
    if (!editTarget) return;
    setEditDraft({
      name: editTarget.name,
      category: editTarget.category,
      command: editTarget.command,
      description: editTarget.description ?? "",
      tags: editTarget.tags.join(", "),
    });
  }, [editTarget]);

  const injectVariables = (cmd: string): string => {
    let result = cmd;
    Object.entries(variables).forEach(([key, value]) => {
      if (value) {
        result = result.replace(new RegExp(`\\$${key}`, "g"), value);
        result = result.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value);
        result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
      }
    });
    result = result.replace(/\$target/g, variables.target_ip || "{target_ip}");
    result = result.replace(
      /\$attacker/g,
      variables.attacker_ip || "{attacker_ip}"
    );
    result = result.replace(/\$port/g, variables.attacker_port || "{port}");
    return result;
  };

  const parseTags = (value: string) =>
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

  const clearSelection = () => setSelectedIds([]);

  const baseCommands = useMemo(() => {
    if (scope !== "project" || !projectId) {
      return globalCommands;
    }
    // Show project commands and global library together in project tab.
    return [...projectCommands, ...globalCommands];
  }, [scope, projectId, projectCommands, globalCommands]);

  const activeCommands = globalFavoritesOnly ? globalCommands : baseCommands;

  const globalFavoriteSet = useMemo(
    () => new Set(globalFavoriteIds),
    [globalFavoriteIds]
  );
  const projectFavoriteSet = useMemo(
    () => new Set(projectFavoriteIds),
    [projectFavoriteIds]
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const enforceFavoritesOnly = favoritesOnly || globalFavoritesOnly;

  const commandById = useMemo(() => {
    const map = new Map<string, Command>();
    baseCommands.forEach((cmd) => {
      map.set(cmd.id, cmd);
    });
    return map;
  }, [baseCommands]);

  const isCommandFavorite = useCallback(
    (cmd: Command) =>
      cmd.scope === "project"
        ? projectFavoriteSet.has(cmd.id)
        : globalFavoriteSet.has(cmd.id),
    [globalFavoriteSet, projectFavoriteSet]
  );

  const handleToggleFavorite = async (command: Command) => {
    const commandId = command.id;
    const useGlobal = command.scope === "global" || !projectId;
    const currentFavorites = useGlobal
      ? globalFavoriteIds
      : projectFavoriteIds;
    const isFavorite = currentFavorites.includes(commandId);
    const nextFavorites = isFavorite
      ? currentFavorites.filter((id) => id !== commandId)
      : [...currentFavorites, commandId];

    if (useGlobal) setGlobalFavoriteIds(nextFavorites);
    else setProjectFavoriteIds(nextFavorites);

    try {
      if (useGlobal) {
        if (isFavorite) {
          await commandsApi.removeGlobalFavorite(commandId);
        } else {
          await commandsApi.addGlobalFavorite(commandId);
        }
      } else if (projectId) {
        if (isFavorite) {
          await commandsApi.removeProjectFavorite(projectId, commandId);
        } else {
          await commandsApi.addProjectFavorite(projectId, commandId);
        }
      }
    } catch {
      if (useGlobal) {
        setGlobalFavoriteIds(currentFavorites);
      } else {
        setProjectFavoriteIds(currentFavorites);
      }
    }
  };

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedIds([]);
      }
      return !prev;
    });
  };

  const toggleCommandSelection = (commandId: string) => {
    setSelectedIds((prev) =>
      prev.includes(commandId)
        ? prev.filter((id) => id !== commandId)
        : [...prev, commandId]
    );
  };

  const updateCommandInState = (updated: Command) => {
    const applyUpdate = (list: Command[]) =>
      list.map((cmd) => (cmd.id === updated.id ? updated : cmd));
    if (updated.scope === "global") {
      setGlobalCommands((prev) => applyUpdate(prev));
    } else {
      setProjectCommands((prev) => applyUpdate(prev));
    }
  };

  const removeCommandsFromState = (ids: string[]) => {
    setGlobalCommands((prev) => prev.filter((cmd) => !ids.includes(cmd.id)));
    setProjectCommands((prev) => prev.filter((cmd) => !ids.includes(cmd.id)));
    setGlobalFavoriteIds((prev) => prev.filter((id) => !ids.includes(id)));
    setProjectFavoriteIds((prev) => prev.filter((id) => !ids.includes(id)));
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    const useGlobal = editTarget.scope === "global" || !projectId;
    const payload = {
      name: editDraft.name.trim() || editTarget.name,
      category: editDraft.category.trim() || editTarget.category,
      command: editDraft.command.trim() || editTarget.command,
      description: editDraft.description.trim()
        ? editDraft.description.trim()
        : null,
      tags: parseTags(editDraft.tags),
    };
    setIsSavingEdit(true);
    try {
      const updated = useGlobal
        ? await commandsApi.updateGlobalCommand(editTarget.id, payload)
        : await commandsApi.updateProjectCommand(
            projectId as string,
            editTarget.id,
            payload
          );
      updateCommandInState(updated);
      setEditTarget(null);
    } catch {
      console.error("Failed to update command");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteIds || confirmDeleteIds.length === 0) {
      setConfirmDeleteIds(null);
      return;
    }

    const globalIds: string[] = [];
    const projectIds: string[] = [];
    confirmDeleteIds.forEach((id) => {
      const cmd = commandById.get(id);
      if (cmd?.scope === "project" && projectId) {
        projectIds.push(id);
      } else {
        globalIds.push(id);
      }
    });

    setIsDeleting(true);
    try {
      await Promise.all([
        ...globalIds.map((id) => commandsApi.deleteGlobalCommand(id)),
        ...projectIds.map((id) =>
          commandsApi.deleteProjectCommand(projectId as string, id)
        ),
      ]);
      removeCommandsFromState(confirmDeleteIds);
      setConfirmDeleteIds(null);
    } catch {
      console.error("Failed to delete commands");
    } finally {
      setIsDeleting(false);
    }
  };

  const categories = useMemo(() => {
    const unique = new Set<string>();
    activeCommands.forEach((cmd) => {
      unique.add(cmd.category.split("/")[0]);
    });
    return Array.from(unique);
  }, [activeCommands]);

  const tagFilters = useMemo(() => {
    const unique = new Set<string>();
    activeCommands.forEach((cmd) => {
      cmd.tags.forEach((tag) => unique.add(tag));
    });
    return Array.from(unique).slice(0, 10);
  }, [activeCommands]);

  const filteredCommands = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return activeCommands.filter((cmd) => {
      if (enforceFavoritesOnly && !isCommandFavorite(cmd)) {
        return false;
      }

      if (selectedCategory && !cmd.category.startsWith(selectedCategory)) {
        return false;
      }

      if (selectedTag && !cmd.tags.includes(selectedTag)) {
        return false;
      }

      if (!normalized) return true;

      const inName = cmd.name.toLowerCase().includes(normalized);
      const inCommand = cmd.command.toLowerCase().includes(normalized);
      const inDescription = cmd.description
        ? cmd.description.toLowerCase().includes(normalized)
        : false;
      const inTags = cmd.tags.some((tag) =>
        tag.toLowerCase().includes(normalized)
      );
      return inName || inCommand || inDescription || inTags;
    });
  }, [
    activeCommands,
    enforceFavoritesOnly,
    isCommandFavorite,
    search,
    selectedCategory,
    selectedTag,
  ]);

  const handlePrimaryFilter = (
    filter: "all" | "favorites" | "global-favorites" | string
  ) => {
    clearSelection();
    if (filter === "all") {
      setSelectedCategory(null);
      setSelectedTag(null);
      setFavoritesOnly(false);
      setGlobalFavoritesOnly(false);
      return;
    }
    if (filter === "favorites") {
      setSelectedCategory(null);
      setSelectedTag(null);
      setFavoritesOnly(true);
      setGlobalFavoritesOnly(false);
      return;
    }
    if (filter === "global-favorites") {
      setSelectedCategory(null);
      setSelectedTag(null);
      setFavoritesOnly(false);
      setGlobalFavoritesOnly(true);
      return;
    }
    setFavoritesOnly(false);
    setGlobalFavoritesOnly(false);
    setSelectedCategory(filter);
  };

  const handleAskAI = () => {
    if (!onAskAI) return;

    const selectedCommands = selectedIds
      .map((id) => commandById.get(id))
      .filter((command): command is Command => Boolean(command));

    if (selectedCommands.length > 0) {
      const selectionSummary = selectedCommands
        .map((command) => {
          const description = command.description
            ? `\nDescription: ${command.description}`
            : "";
          return `- ${command.name}\nCommand: ${injectVariables(command.command)}${description}`;
        })
        .join("\n\n");

      onAskAI(
        `Help me choose the best command from this shortlist for the current pentest step.\n\nSelected commands:\n${selectionSummary}`
      );
      return;
    }

    if (search.trim()) {
      onAskAI(
        `Find the most relevant pentest command for this goal: "${search.trim()}". Prefer commands already present in the library and explain briefly when to use it.`
      );
      return;
    }

    if (scope === "project" && projectId) {
      onAskAI(
        "Suggest the next command to run for this project based on the current command library. Prefer safe defaults and ask for any missing variables."
      );
      return;
    }

    onAskAI(
      "Suggest a useful pentest command from the current command library and explain briefly when to use it."
    );
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm font-medium tracking-wide">
          Syncing Command Database...
        </span>
      </div>
    );
  }

  const commandsContent =
    filteredCommands.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-20 text-text-muted">
        <p className="text-sm">No commands matched your query</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6">
        {filteredCommands.map((cmd) => {
          const resolvedCommand = injectVariables(cmd.command);
          return (
            <CommandCard
              key={cmd.id}
              id={cmd.id}
              name={cmd.name}
              category={cmd.category.split("/")[0]}
              command={resolvedCommand}
              description={cmd.description}
              tags={cmd.tags}
              isFavorite={isCommandFavorite(cmd)}
              onToggleFavorite={() => handleToggleFavorite(cmd)}
              isSelectable={selectionMode}
              isSelected={selectedSet.has(cmd.id)}
              onSelectToggle={() => toggleCommandSelection(cmd.id)}
              onEdit={() => setEditTarget(cmd)}
              onDelete={() => setConfirmDeleteIds([cmd.id])}
              onCopy={() => onCopyCommand(resolvedCommand)}
              onRun={
                onRunCommand
                  ? () => onRunCommand(resolvedCommand)
                  : undefined
              }
            />
          );
        })}
      </div>
    );

  return (
    <div className={`flex flex-1 flex-col ${fullPageScroll ? "" : "overflow-hidden"}`}>
      <div className="flex flex-col gap-3 pb-3">
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
            <Search className="h-4 w-4" />
          </div>
          <input
            className="w-full bg-background-dark border border-border-dark text-text-primary text-sm rounded-md focus:ring-1 focus:ring-primary focus:border-primary block w-full pl-10 pr-20 p-2.5 placeholder-text-muted"
            placeholder={
              scope === "project"
                ? "Search project + global command database (e.g., 'nmap', 'reverse shell')..."
                : "Search global command database (e.g., 'nmap', 'reverse shell')..."
            }
            type="text"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleAskAI}
              className="group flex items-center justify-center p-1 rounded hover:bg-surface-highlight transition-colors"
              title="Ask AI to find a command"
            >
              <Bot className="h-4 w-4 text-primary group-hover:text-accent-blue" />
            </button>
            <span className="text-xs text-text-muted border border-border-dark rounded px-1.5 py-0.5">
              CMD+K
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectionMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap border ${
                selectionMode
                  ? "bg-primary text-white border-primary"
                  : "bg-card-dark border-border-dark text-text-primary hover:bg-surface-highlight"
              }`}
            >
              <ListChecks className="h-3 w-3" />
              {selectionMode ? "Selection On" : "Select"}
            </button>
            {selectionMode && (
              <span className="text-xs text-text-muted">
                {selectedIds.length} selected
              </span>
            )}
          </div>
          {selectionMode && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteIds(selectedIds)}
                disabled={selectedIds.length === 0}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap border ${
                  selectedIds.length === 0
                    ? "bg-card-dark border-border-dark text-text-muted cursor-not-allowed"
                    : "bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20"
                }`}
              >
                Delete selected
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap border bg-card-dark border-border-dark text-text-primary hover:bg-surface-highlight"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          <button
            type="button"
            onClick={() => handlePrimaryFilter("all")}
            className={`flex items-center px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
              !favoritesOnly && !selectedCategory && !globalFavoritesOnly
                ? "bg-primary text-white"
                : "bg-card-dark border border-border-dark text-text-primary hover:bg-surface-highlight"
            }`}
          >
            All Commands
          </button>
          <button
            type="button"
            onClick={() => handlePrimaryFilter("favorites")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
              favoritesOnly && !globalFavoritesOnly
                ? "bg-primary text-white"
                : "bg-card-dark border border-border-dark text-text-primary hover:bg-surface-highlight"
            }`}
          >
            <Star className="h-3 w-3 text-accent-yellow" />
            Favorites
          </button>
          {scope === "project" && projectId ? (
            <button
              type="button"
              onClick={() => handlePrimaryFilter("global-favorites")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
                globalFavoritesOnly
                  ? "bg-primary text-white"
                  : "bg-card-dark border border-border-dark text-text-primary hover:bg-surface-highlight"
              }`}
            >
              <Star className="h-3 w-3 text-primary" />
              Global Favorites
            </button>
          ) : null}
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => handlePrimaryFilter(cat)}
              className={`flex items-center px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
                selectedCategory === cat
                  ? "bg-primary text-white"
                  : "bg-card-dark border border-border-dark text-text-primary hover:bg-surface-highlight"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {tagFilters.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide border-b border-border-dark/50 pb-3">
            <span className="text-xs text-text-muted self-center mr-1">
              Filter:
            </span>
            {tagFilters.map((tag) => {
              const isActive = selectedTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setSelectedTag(isActive ? null : tag);
                    clearSelection();
                  }}
                  className={`flex items-center px-2.5 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                    isActive
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-card-dark text-text-muted border-border-dark hover:text-white hover:border-text-muted"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {fullPageScroll ? (
        <div>{commandsContent}</div>
      ) : (
        <ScrollArea className="flex-1">{commandsContent}</ScrollArea>
      )}

      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
          }
        }}
      >
        <DialogContent className="bg-surface-dark border-border-dark text-text-primary">
          <DialogHeader>
            <DialogTitle>Edit Command</DialogTitle>
            <DialogDescription className="text-text-secondary">
              Update the command details directly from the library.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                Name
              </label>
              <Input
                value={editDraft.name}
                onChange={(event) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                className="bg-background-dark border-border-dark"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                Category
              </label>
              <Input
                value={editDraft.category}
                onChange={(event) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    category: event.target.value,
                  }))
                }
                className="bg-background-dark border-border-dark"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                Command
              </label>
              <Input
                value={editDraft.command}
                onChange={(event) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    command: event.target.value,
                  }))
                }
                className="bg-background-dark border-border-dark font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                Description
              </label>
              <Input
                value={editDraft.description}
                onChange={(event) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                className="bg-background-dark border-border-dark"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                Tags (comma separated)
              </label>
              <Input
                value={editDraft.tags}
                onChange={(event) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    tags: event.target.value,
                  }))
                }
                className="bg-background-dark border-border-dark"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditTarget(null)}
              disabled={isSavingEdit}
            >
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={isSavingEdit}>
              {isSavingEdit ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(confirmDeleteIds)}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDeleteIds(null);
          }
        }}
      >
        <DialogContent className="bg-surface-dark border-border-dark text-text-primary">
          <DialogHeader>
            <DialogTitle>Delete command(s)?</DialogTitle>
            <DialogDescription className="text-text-secondary">
              {confirmDeleteIds?.length === 1
                ? "This command will be permanently removed."
                : `This will permanently remove ${confirmDeleteIds?.length ?? 0} commands.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmDeleteIds(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
