import { useMemo, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCommandSettingsStore } from "@/stores/commandSettingsStore";
import type {
  Command,
  CommandInput,
  CommandCategory,
  CommandFilter,
  CommandUpdate,
} from "@/api/commands";

type Scope = "global" | "project";

interface CommandSettingsSectionsProps {
  scope: Scope;
  projectId?: string;
}

type CommandDraft = {
  name?: string;
  category?: string;
  command?: string;
  description?: string;
  tags?: string;
};

type LabelDraft = {
  name?: string;
  sort_order?: string;
};

const parseTags = (value: string) =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const formatTags = (tags: string[]) => tags.join(", ");

const parseSortOrder = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numberValue = Number(trimmed);
  return Number.isFinite(numberValue) ? numberValue : null;
};

export function CommandSettingsSections({
  scope,
  projectId,
}: CommandSettingsSectionsProps) {
  const {
    commands,
    categories,
    filters,
    createGlobalCommand,
    updateGlobalCommand,
    deleteGlobalCommand,
    createProjectCommand,
    updateProjectCommand,
    deleteProjectCommand,
    createGlobalCategory,
    updateGlobalCategory,
    deleteGlobalCategory,
    createProjectCategory,
    updateProjectCategory,
    deleteProjectCategory,
    createGlobalFilter,
    updateGlobalFilter,
    deleteGlobalFilter,
    createProjectFilter,
    updateProjectFilter,
    deleteProjectFilter,
  } = useCommandSettingsStore();

  const [newCommand, setNewCommand] = useState({
    name: "",
    category: "",
    command: "",
    description: "",
    tags: "",
  });
  const [commandDrafts, setCommandDrafts] = useState<Record<string, CommandDraft>>(
    {}
  );

  const [newCategory, setNewCategory] = useState({ name: "", sort_order: "" });
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, LabelDraft>>(
    {}
  );

  const [newFilter, setNewFilter] = useState({ name: "", sort_order: "" });
  const [filterDrafts, setFilterDrafts] = useState<Record<string, LabelDraft>>({});

  const canUseProject = scope === "project" && projectId;

  const commandActions = useMemo(() => {
    if (scope === "global") {
      return {
        create: createGlobalCommand,
        update: updateGlobalCommand,
        remove: deleteGlobalCommand,
      };
    }
    return {
      create: (data: CommandInput) =>
        canUseProject
          ? createProjectCommand(projectId, data)
          : Promise.reject(new Error("Missing project id")),
      update: (id: string, data: CommandUpdate) =>
        canUseProject
          ? updateProjectCommand(projectId, id, data)
          : Promise.resolve(),
      remove: (id: string) =>
        canUseProject
          ? deleteProjectCommand(projectId, id)
          : Promise.resolve(),
    };
  }, [
    scope,
    canUseProject,
    createGlobalCommand,
    updateGlobalCommand,
    deleteGlobalCommand,
    createProjectCommand,
    updateProjectCommand,
    deleteProjectCommand,
    projectId,
  ]);

  const categoryActions = useMemo(() => {
    if (scope === "global") {
      return {
        create: createGlobalCategory,
        update: updateGlobalCategory,
        remove: deleteGlobalCategory,
      };
    }
    return {
      create: (data: { name: string; sort_order?: number | null }) =>
        canUseProject
          ? createProjectCategory(projectId, data)
          : Promise.reject(new Error("Missing project id")),
      update: (id: string, data: { name?: string; sort_order?: number | null }) =>
        canUseProject ? updateProjectCategory(projectId, id, data) : Promise.resolve(),
      remove: (id: string) =>
        canUseProject ? deleteProjectCategory(projectId, id) : Promise.resolve(),
    };
  }, [
    scope,
    canUseProject,
    createGlobalCategory,
    updateGlobalCategory,
    deleteGlobalCategory,
    createProjectCategory,
    updateProjectCategory,
    deleteProjectCategory,
    projectId,
  ]);

  const filterActions = useMemo(() => {
    if (scope === "global") {
      return {
        create: createGlobalFilter,
        update: updateGlobalFilter,
        remove: deleteGlobalFilter,
      };
    }
    return {
      create: (data: { name: string; sort_order?: number | null }) =>
        canUseProject
          ? createProjectFilter(projectId, data)
          : Promise.reject(new Error("Missing project id")),
      update: (id: string, data: { name?: string; sort_order?: number | null }) =>
        canUseProject ? updateProjectFilter(projectId, id, data) : Promise.resolve(),
      remove: (id: string) =>
        canUseProject ? deleteProjectFilter(projectId, id) : Promise.resolve(),
    };
  }, [
    scope,
    canUseProject,
    createGlobalFilter,
    updateGlobalFilter,
    deleteGlobalFilter,
    createProjectFilter,
    updateProjectFilter,
    deleteProjectFilter,
    projectId,
  ]);

  const handleCommandDraftChange = (
    id: string,
    field: keyof CommandDraft,
    value: string
  ) => {
    setCommandDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleCommandSave = async (command: Command) => {
    const draft = commandDrafts[command.id];
    if (!draft) return;
    const update: CommandUpdate = {
      name: draft.name ?? command.name,
      category: draft.category ?? command.category,
      command: draft.command ?? command.command,
      description:
        draft.description !== undefined
          ? draft.description
          : command.description ?? "",
      tags:
        draft.tags !== undefined
          ? parseTags(draft.tags)
          : command.tags,
    };
    await commandActions.update(command.id, update);
    setCommandDrafts((prev) => {
      const next = { ...prev };
      delete next[command.id];
      return next;
    });
  };

  const handleCommandReset = (id: string) => {
    setCommandDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleCategoryDraftChange = (
    id: string,
    field: keyof LabelDraft,
    value: string
  ) => {
    setCategoryDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleCategorySave = async (category: CommandCategory) => {
    const draft = categoryDrafts[category.id];
    if (!draft) return;
    await categoryActions.update(category.id, {
      name: draft.name ?? category.name,
      sort_order:
        draft.sort_order !== undefined
          ? parseSortOrder(draft.sort_order)
          : category.sort_order ?? null,
    });
    setCategoryDrafts((prev) => {
      const next = { ...prev };
      delete next[category.id];
      return next;
    });
  };

  const handleCategoryReset = (id: string) => {
    setCategoryDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleFilterDraftChange = (
    id: string,
    field: keyof LabelDraft,
    value: string
  ) => {
    setFilterDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleFilterSave = async (filter: CommandFilter) => {
    const draft = filterDrafts[filter.id];
    if (!draft) return;
    await filterActions.update(filter.id, {
      name: draft.name ?? filter.name,
      sort_order:
        draft.sort_order !== undefined
          ? parseSortOrder(draft.sort_order)
          : filter.sort_order ?? null,
    });
    setFilterDrafts((prev) => {
      const next = { ...prev };
      delete next[filter.id];
      return next;
    });
  };

  const handleFilterReset = (id: string) => {
    setFilterDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleCreateCommand = async () => {
    if (!newCommand.name.trim() || !newCommand.category.trim() || !newCommand.command.trim()) {
      return;
    }
    await commandActions.create({
      name: newCommand.name.trim(),
      category: newCommand.category.trim(),
      command: newCommand.command.trim(),
      description: newCommand.description.trim() || undefined,
      tags: parseTags(newCommand.tags),
      is_custom: true,
    });
    setNewCommand({
      name: "",
      category: "",
      command: "",
      description: "",
      tags: "",
    });
  };

  const handleCreateCategory = async () => {
    if (!newCategory.name.trim()) return;
    await categoryActions.create({
      name: newCategory.name.trim(),
      sort_order: parseSortOrder(newCategory.sort_order),
    });
    setNewCategory({ name: "", sort_order: "" });
  };

  const handleCreateFilter = async () => {
    if (!newFilter.name.trim()) return;
    await filterActions.create({
      name: newFilter.name.trim(),
      sort_order: parseSortOrder(newFilter.sort_order),
    });
    setNewFilter({ name: "", sort_order: "" });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-card-dark border border-border-dark rounded-md p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Commands</h3>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <div
            className="grid grid-cols-1 gap-3 rounded-md border border-border-dark bg-background-dark p-4"
            data-testid={`command-settings-create-form-${scope}`}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                aria-label="New command name"
                placeholder="Command name"
                value={newCommand.name}
                onChange={(event) =>
                  setNewCommand((prev) => ({ ...prev, name: event.target.value }))
                }
                className="bg-surface-dark border-border-dark text-white"
              />
              <Input
                aria-label="New command category"
                placeholder="Category (e.g. Recon)"
                value={newCommand.category}
                onChange={(event) =>
                  setNewCommand((prev) => ({
                    ...prev,
                    category: event.target.value,
                  }))
                }
                className="bg-surface-dark border-border-dark text-white"
              />
            </div>
            <Input
              aria-label="New command body"
              placeholder="Command (e.g. nmap -sV $target_ip)"
              value={newCommand.command}
              onChange={(event) =>
                setNewCommand((prev) => ({ ...prev, command: event.target.value }))
              }
              className="bg-surface-dark border-border-dark text-white"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                aria-label="New command description"
                placeholder="Description"
                value={newCommand.description}
                onChange={(event) =>
                  setNewCommand((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                className="bg-surface-dark border-border-dark text-white"
              />
              <Input
                aria-label="New command tags"
                placeholder="Tags (comma separated)"
                value={newCommand.tags}
                onChange={(event) =>
                  setNewCommand((prev) => ({ ...prev, tags: event.target.value }))
                }
                className="bg-surface-dark border-border-dark text-white"
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleCreateCommand}>
                <Plus className="h-4 w-4" />
                Add Command
              </Button>
            </div>
          </div>

          {commands.map((command) => {
            const draft = commandDrafts[command.id] || {};
            return (
              <div
                key={command.id}
                className="rounded-md border border-border-dark bg-background-dark p-4"
                data-testid="command-settings-command-row"
                data-command-id={command.id}
                data-command-name={command.name}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    aria-label="Command name"
                    placeholder="Command name"
                    value={draft.name ?? command.name}
                    onChange={(event) =>
                      handleCommandDraftChange(command.id, "name", event.target.value)
                    }
                    className="bg-surface-dark border-border-dark text-white"
                  />
                  <Input
                    aria-label="Command category"
                    placeholder="Category"
                    value={draft.category ?? command.category}
                    onChange={(event) =>
                      handleCommandDraftChange(
                        command.id,
                        "category",
                        event.target.value
                      )
                    }
                    className="bg-surface-dark border-border-dark text-white"
                  />
                </div>
                <Input
                  aria-label="Command body"
                  placeholder="Command"
                  value={draft.command ?? command.command}
                  onChange={(event) =>
                    handleCommandDraftChange(command.id, "command", event.target.value)
                  }
                  className="bg-surface-dark border-border-dark text-white mt-3"
                />
                <div className="grid gap-3 md:grid-cols-2 mt-3">
                  <Input
                    aria-label="Command description"
                    placeholder="Description"
                    value={draft.description ?? command.description ?? ""}
                    onChange={(event) =>
                      handleCommandDraftChange(
                        command.id,
                        "description",
                        event.target.value
                      )
                    }
                    className="bg-surface-dark border-border-dark text-white"
                  />
                  <Input
                    aria-label="Command tags"
                    placeholder="Tags"
                    value={draft.tags ?? formatTags(command.tags)}
                    onChange={(event) =>
                      handleCommandDraftChange(command.id, "tags", event.target.value)
                    }
                    className="bg-surface-dark border-border-dark text-white"
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Save command ${command.name}`}
                    onClick={() => handleCommandSave(command)}
                  >
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Reset command ${command.name}`}
                    onClick={() => handleCommandReset(command.id)}
                  >
                    <X className="h-4 w-4" />
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    aria-label={`Delete command ${command.name}`}
                    onClick={() => commandActions.remove(command.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-card-dark border border-border-dark rounded-md p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Categories</h3>
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 rounded-md border border-border-dark bg-background-dark p-4 md:flex-row md:items-center">
            <Input
              placeholder="Category name"
              value={newCategory.name}
              onChange={(event) =>
                setNewCategory((prev) => ({ ...prev, name: event.target.value }))
              }
              className="bg-surface-dark border-border-dark text-white"
            />
            <Input
              placeholder="Sort order"
              value={newCategory.sort_order}
              onChange={(event) =>
                setNewCategory((prev) => ({
                  ...prev,
                  sort_order: event.target.value,
                }))
              }
              className="bg-surface-dark border-border-dark text-white md:w-40"
            />
            <Button size="sm" onClick={handleCreateCategory} className="md:ml-auto">
              <Plus className="h-4 w-4" />
              Add Category
            </Button>
          </div>

          {categories.map((category) => {
            const draft = categoryDrafts[category.id] || {};
            return (
              <div
                key={category.id}
                className="flex flex-col gap-3 rounded-md border border-border-dark bg-background-dark p-4 md:flex-row md:items-center"
              >
                <Input
                  placeholder="Category name"
                  value={draft.name ?? category.name}
                  onChange={(event) =>
                    handleCategoryDraftChange(category.id, "name", event.target.value)
                  }
                  className="bg-surface-dark border-border-dark text-white"
                />
                <Input
                  placeholder="Sort order"
                  value={
                    draft.sort_order ??
                    (category.sort_order !== null ? String(category.sort_order) : "")
                  }
                  onChange={(event) =>
                    handleCategoryDraftChange(
                      category.id,
                      "sort_order",
                      event.target.value
                    )
                  }
                  className="bg-surface-dark border-border-dark text-white md:w-40"
                />
                <div className="flex flex-wrap gap-2 md:ml-auto">
                  <Button size="sm" variant="secondary" onClick={() => handleCategorySave(category)}>
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCategoryReset(category.id)}
                  >
                    <X className="h-4 w-4" />
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => categoryActions.remove(category.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-card-dark border border-border-dark rounded-md p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Filters</h3>
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 rounded-md border border-border-dark bg-background-dark p-4 md:flex-row md:items-center">
            <Input
              placeholder="Filter name"
              value={newFilter.name}
              onChange={(event) =>
                setNewFilter((prev) => ({ ...prev, name: event.target.value }))
              }
              className="bg-surface-dark border-border-dark text-white"
            />
            <Input
              placeholder="Sort order"
              value={newFilter.sort_order}
              onChange={(event) =>
                setNewFilter((prev) => ({
                  ...prev,
                  sort_order: event.target.value,
                }))
              }
              className="bg-surface-dark border-border-dark text-white md:w-40"
            />
            <Button size="sm" onClick={handleCreateFilter} className="md:ml-auto">
              <Plus className="h-4 w-4" />
              Add Filter
            </Button>
          </div>

          {filters.map((filter) => {
            const draft = filterDrafts[filter.id] || {};
            return (
              <div
                key={filter.id}
                className="flex flex-col gap-3 rounded-md border border-border-dark bg-background-dark p-4 md:flex-row md:items-center"
              >
                <Input
                  placeholder="Filter name"
                  value={draft.name ?? filter.name}
                  onChange={(event) =>
                    handleFilterDraftChange(filter.id, "name", event.target.value)
                  }
                  className="bg-surface-dark border-border-dark text-white"
                />
                <Input
                  placeholder="Sort order"
                  value={
                    draft.sort_order ??
                    (filter.sort_order !== null ? String(filter.sort_order) : "")
                  }
                  onChange={(event) =>
                    handleFilterDraftChange(
                      filter.id,
                      "sort_order",
                      event.target.value
                    )
                  }
                  className="bg-surface-dark border-border-dark text-white md:w-40"
                />
                <div className="flex flex-wrap gap-2 md:ml-auto">
                  <Button size="sm" variant="secondary" onClick={() => handleFilterSave(filter)}>
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleFilterReset(filter.id)}
                  >
                    <X className="h-4 w-4" />
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => filterActions.remove(filter.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
