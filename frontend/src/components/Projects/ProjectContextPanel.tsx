import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importProjectContextMetadata } from "@/api/projectContext";
import type { Project, ProjectVariables } from "@/types";
import {
  buildProjectContextState,
  importProjectContextFromUrl,
  mergeImportedProjectContext,
  mergeProjectContextIntoVariables,
  type ProjectContextState,
} from "@/lib/projectContext";

interface ProjectContextPanelProps {
  projectType: Project["type"];
  variables: ProjectVariables;
  onSave: (variables: ProjectVariables) => Promise<unknown> | unknown;
}

const ENGAGEMENT_TYPE_OPTIONS = [
  { value: "platform_lab", label: "Platform Lab" },
  { value: "ctf", label: "CTF" },
  { value: "practice", label: "Other Training" },
];

const platformNameByProjectType: Partial<Record<Project["type"], string>> = {
  htb: "Hack The Box",
  thm: "TryHackMe",
};

const engagementKindByProjectType: Partial<Record<Project["type"], string>> = {
  htb: "platform_lab",
  thm: "platform_lab",
  ctf: "ctf",
};

const buildInitialState = (
  projectType: Project["type"],
  variables: ProjectVariables
): ProjectContextState => {
  const state = buildProjectContextState(variables);

  if (!state.platform_name && platformNameByProjectType[projectType]) {
    state.platform_name = platformNameByProjectType[projectType] ?? "";
  }

  if (
    (!state.engagement_kind || state.engagement_kind === "practice") &&
    engagementKindByProjectType[projectType]
  ) {
    state.engagement_kind = engagementKindByProjectType[projectType] ?? "practice";
  }

  return state;
};

export function ProjectContextPanel({
  projectType,
  variables,
  onSave,
}: ProjectContextPanelProps) {
  const [formState, setFormState] = useState<ProjectContextState>(() =>
    buildInitialState(projectType, variables)
  );
  const formStateRef = useRef(formState);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    setFormState(buildInitialState(projectType, variables));
  }, [projectType, variables]);

  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  const updateField =
    (field: keyof ProjectContextState) =>
    (
      event: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => {
      const nextValue = event.target.value;
      setStatusMessage("");
      setFormState((prev) => ({ ...prev, [field]: nextValue }));
    };

  const handleImport = async () => {
    const currentState = formStateRef.current;
    const baseImport = importProjectContextFromUrl(currentState.platform_url);
    let importedState = baseImport;
    let nextStatusMessage = baseImport.platform_name
      ? "Platform metadata imported. Live machine IP still needs to be set manually unless the platform exposes it."
      : "Saved the URL. No platform-specific metadata could be inferred.";

    setIsImporting(true);
    setStatusMessage("");

    try {
      const enriched = await importProjectContextMetadata(currentState.platform_url);
      importedState = {
        ...baseImport,
        ...Object.fromEntries(
          Object.entries(enriched?.context ?? {}).filter(([, value]) =>
            typeof value === "string" ? value.trim() : false
          )
        ),
      } as ProjectContextState;

      if (enriched?.messages?.length) {
        nextStatusMessage = enriched.messages.join(" ");
      }
    } catch {
      // Keep the local URL parse result as the fallback import behavior.
    } finally {
      setIsImporting(false);
    }

    setFormState((prev) => mergeImportedProjectContext(prev, importedState));
    setStatusMessage(nextStatusMessage);
  };

  const handleSave = async () => {
    const currentState = formStateRef.current;
    setIsSaving(true);
    setStatusMessage("");
    try {
      await onSave(mergeProjectContextIntoVariables(currentState, variables));
      setStatusMessage("Project context saved.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background-dark">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">
              Project Context
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Define what this project is, where it comes from, and what the AI
              should keep in mind across the whole engagement.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#121722] px-4 py-3 text-xs uppercase tracking-[0.24em] text-slate-500">
            Project Type: {projectType.toUpperCase()}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-2xl border border-white/5 bg-[#121722] p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Briefing
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-engagement-kind"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Engagement Type
                </label>
                <select
                  id="context-engagement-kind"
                  value={formState.engagement_kind}
                  onChange={updateField("engagement_kind")}
                  className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
                >
                  {ENGAGEMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-platform"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Platform
                </label>
                <Input
                  id="context-platform"
                  value={formState.platform_name}
                  onChange={updateField("platform_name")}
                  className="border-white/10 bg-black/30 text-slate-200"
                  placeholder="e.g. Hack The Box, TryHackMe, VulnHub"
                />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <label
                  htmlFor="context-platform-url"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Platform URL
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    id="context-platform-url"
                    value={formState.platform_url}
                    onChange={updateField("platform_url")}
                    className="border-white/10 bg-black/30 text-slate-200"
                    placeholder="Paste a room, machine, challenge, or lab URL"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    disabled={isImporting}
                    onClick={() => void handleImport()}
                  >
                    {isImporting ? "Importing..." : "Import URL"}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  URL import is best-effort. It can infer platform metadata and
                  slugs, but live IP discovery still depends on platform support.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-content-type"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Content Type
                </label>
                <Input
                  id="context-content-type"
                  value={formState.platform_content_type}
                  onChange={updateField("platform_content_type")}
                  className="border-white/10 bg-black/30 text-slate-200"
                  placeholder="machine, room, lab, challenge"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-difficulty"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Difficulty
                </label>
                <Input
                  id="context-difficulty"
                  value={formState.platform_difficulty}
                  onChange={updateField("platform_difficulty")}
                  className="border-white/10 bg-black/30 text-slate-200"
                  placeholder="easy, medium, hard"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-target-name"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Target Name
                </label>
                <Input
                  id="context-target-name"
                  value={formState.platform_target_name}
                  onChange={updateField("platform_target_name")}
                  className="border-white/10 bg-black/30 text-slate-200"
                  placeholder="Machine, room, or target label"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-target-slug"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Target Slug
                </label>
                <Input
                  id="context-target-slug"
                  value={formState.platform_target_slug}
                  onChange={updateField("platform_target_slug")}
                  className="border-white/10 bg-black/30 text-slate-200"
                  placeholder="analytics, adventofcyber3"
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/5 bg-[#121722] p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Target
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-target-ip"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Target IP
                </label>
                <Input
                  id="context-target-ip"
                  value={formState.target_ip}
                  onChange={updateField("target_ip")}
                  className="border-white/10 bg-black/30 text-slate-200"
                  placeholder="10.10.10.10"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-target-domain"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Target Domain
                </label>
                <Input
                  id="context-target-domain"
                  value={formState.target_domain}
                  onChange={updateField("target_domain")}
                  className="border-white/10 bg-black/30 text-slate-200"
                  placeholder="target.htb"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-target-os"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  OS
                </label>
                <Input
                  id="context-target-os"
                  value={formState.os}
                  onChange={updateField("os")}
                  className="border-white/10 bg-black/30 text-slate-200"
                  placeholder="Linux, Windows, FreeBSD"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-target-scope"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Scope
                </label>
                <Input
                  id="context-target-scope"
                  value={formState.scope}
                  onChange={updateField("scope")}
                  className="border-white/10 bg-black/30 text-slate-200"
                  placeholder="IPs, domains, ports, constraints"
                />
              </div>
            </div>
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-white/5 bg-[#121722] p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Operator Notes
            </div>
            <div className="mt-4 grid gap-4">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-objective"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Objective
                </label>
                <textarea
                  id="context-objective"
                  value={formState.objective}
                  onChange={updateField("objective")}
                  className="min-h-[92px] rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary/60"
                  placeholder="What success looks like for this engagement."
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-constraints"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Constraints
                </label>
                <textarea
                  id="context-constraints"
                  value={formState.constraints}
                  onChange={updateField("constraints")}
                  className="min-h-[92px] rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary/60"
                  placeholder="Rules of engagement, tooling limits, no-go zones."
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-notes"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  Notes
                </label>
                <textarea
                  id="context-notes"
                  value={formState.notes}
                  onChange={updateField("notes")}
                  className="min-h-[110px] rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary/60"
                  placeholder="Extra machine context, hints, or manual observations."
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/5 bg-[#121722] p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
              AI Briefing
            </div>
            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="context-ai-briefing"
                  className="text-xs uppercase tracking-[0.2em] text-slate-500"
                >
                  AI Briefing
                </label>
                <textarea
                  id="context-ai-briefing"
                  value={formState.ai_briefing}
                  onChange={updateField("ai_briefing")}
                  className="min-h-[244px] rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary/60"
                  placeholder="Persistent context for the AI: style, priorities, assumptions to hold, and what matters for this target."
                />
              </div>
              <p className="text-sm leading-6 text-slate-400">
                This text is meant to persist across the project so the AI keeps
                the right operational context without having to restate it in
                every message.
              </p>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-[#121722] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-400">
            {statusMessage ||
              "Save once the context looks right. Command templates will continue to use project variables like target IP and OS automatically."}
          </p>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Context"}
          </Button>
        </div>
      </div>
    </div>
  );
}
