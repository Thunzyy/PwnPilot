import { useState, type ChangeEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { NormalizedVpnPlatformProfile } from "@/lib/vpn";
import type { ProjectVariables } from "../../types";

interface ProjectSetupPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: { variables: ProjectVariables; status?: string }) => void;
  defaultValues: Partial<ProjectVariables>;
  defaultStatus?: string;
  vpnPlatforms?: NormalizedVpnPlatformProfile[];
}

interface SetupFormState {
  target_ip: string;
  target_domain: string;
  scope: string;
  os: string;
  credentials: string;
  tags: string;
  notes: string;
  priority: string;
  deadline: string;
  vpn_platform: string;
  vpn_path: string;
  vpn_connect_command: string;
  vpn_content: string;
  status: string;
}

const STATUS_OPTIONS = ["active", "paused", "completed"];

const buildStateFromDefaults = (
  defaults: Partial<ProjectVariables>,
  defaultStatus?: string
): SetupFormState => ({
  target_ip: defaults.target_ip || "",
  target_domain: defaults.target_domain || "",
  scope: defaults.scope || "",
  os: defaults.os || "",
  credentials: defaults.credentials || "",
  tags: defaults.tags || "",
  notes: defaults.notes || "",
  priority: defaults.priority || "",
  deadline: defaults.deadline || "",
  vpn_platform: defaults.vpn_platform || "",
  vpn_path: defaults.vpn_path || "",
  vpn_connect_command: defaults.vpn_connect_command || "",
  vpn_content: defaults.vpn_content || "",
  status: defaultStatus || "",
});

const assignIfValue = (
  variables: ProjectVariables,
  key: string,
  value: string
) => {
  const normalized = value.trim();
  if (normalized) {
    variables[key] = normalized;
  }
};

interface ProjectSetupFormProps {
  defaultStatus?: string;
  defaultValues: Partial<ProjectVariables>;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: { variables: ProjectVariables; status?: string }) => void;
  vpnPlatforms: NormalizedVpnPlatformProfile[];
}

function ProjectSetupForm({
  defaultStatus,
  defaultValues,
  onOpenChange,
  onSave,
  vpnPlatforms,
}: ProjectSetupFormProps) {
  const [formState, setFormState] = useState<SetupFormState>(() =>
    buildStateFromDefaults(defaultValues, defaultStatus)
  );

  const updateField = (field: keyof SetupFormState) => {
    return (
      event: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => setFormState((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSave = async () => {
    const variables: ProjectVariables = {};
    assignIfValue(variables, "target_ip", formState.target_ip);
    assignIfValue(variables, "target_domain", formState.target_domain);
    assignIfValue(variables, "scope", formState.scope);
    assignIfValue(variables, "os", formState.os);
    assignIfValue(variables, "credentials", formState.credentials);
    assignIfValue(variables, "tags", formState.tags);
    assignIfValue(variables, "notes", formState.notes);
    assignIfValue(variables, "priority", formState.priority);
    assignIfValue(variables, "deadline", formState.deadline);
    assignIfValue(variables, "vpn_platform", formState.vpn_platform);
    assignIfValue(variables, "vpn_path", formState.vpn_path);
    assignIfValue(variables, "vpn_connect_command", formState.vpn_connect_command);
    assignIfValue(variables, "vpn_content", formState.vpn_content);

    const status = formState.status.trim() || undefined;

    try {
      await onSave({ variables, status });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save project setup", error);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Project Setup</DialogTitle>
        <DialogDescription className="text-slate-400">
          Capture the scope, target details, and infrastructure defaults for
          this engagement.
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-[60vh] pr-4">
        <div className="space-y-6">
          <div>
            <h3 className="text-xs uppercase tracking-widest text-slate-500">
              Targets
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Input
                placeholder="Target IP"
                value={formState.target_ip}
                onChange={updateField("target_ip")}
                className="bg-black/30 border-white/10"
              />
              <Input
                placeholder="Target domain"
                value={formState.target_domain}
                onChange={updateField("target_domain")}
                className="bg-black/30 border-white/10"
              />
              <Input
                placeholder="Scope (IPs, subnets, endpoints)"
                value={formState.scope}
                onChange={updateField("scope")}
                className="bg-black/30 border-white/10 md:col-span-2"
              />
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-widest text-slate-500">
              Environment
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Input
                placeholder="Target OS"
                value={formState.os}
                onChange={updateField("os")}
                className="bg-black/30 border-white/10"
              />
              <Input
                placeholder="Credentials"
                value={formState.credentials}
                onChange={updateField("credentials")}
                className="bg-black/30 border-white/10"
              />
              <Input
                placeholder="Tags"
                value={formState.tags}
                onChange={updateField("tags")}
                className="bg-black/30 border-white/10"
              />
              <Input
                placeholder="Priority"
                value={formState.priority}
                onChange={updateField("priority")}
                className="bg-black/30 border-white/10"
              />
              <Input
                placeholder="Deadline"
                value={formState.deadline}
                onChange={updateField("deadline")}
                className="bg-black/30 border-white/10"
              />
              <div className="flex flex-col">
                <label
                  htmlFor="project-status"
                  className="text-xs text-slate-500 mb-1"
                >
                  Status
                </label>
                <select
                  id="project-status"
                  value={formState.status}
                  onChange={updateField("status")}
                  className="h-9 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
                >
                  <option value="">Set status</option>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-widest text-slate-500">
              Notes
            </h3>
            <div className="mt-3">
              <textarea
                placeholder="Operational notes, objectives, or constraints"
                value={formState.notes}
                onChange={updateField("notes")}
                className="min-h-[100px] w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary/60"
              />
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-widest text-slate-500">
              VPN
            </h3>
            <div className="mt-3 grid gap-3">
              <div className="flex flex-col">
                <label
                  htmlFor="project-vpn-platform"
                  className="text-xs text-slate-500 mb-1"
                >
                  VPN Platform
                </label>
                <select
                  id="project-vpn-platform"
                  value={formState.vpn_platform}
                  onChange={updateField("vpn_platform")}
                  className="h-9 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
                >
                  <option value="">Use project type default</option>
                  {vpnPlatforms.map((platform) => (
                    <option key={platform.id} value={platform.id}>
                      {platform.label}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                placeholder="VPN file path"
                value={formState.vpn_path}
                onChange={updateField("vpn_path")}
                className="bg-black/30 border-white/10"
              />
              <Input
                placeholder="VPN connect command"
                value={formState.vpn_connect_command}
                onChange={updateField("vpn_connect_command")}
                className="bg-black/30 border-white/10 font-mono"
              />
              <textarea
                placeholder="VPN file content"
                value={formState.vpn_content}
                onChange={updateField("vpn_content")}
                className="min-h-[120px] w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary/60"
              />
            </div>
          </div>
        </div>
      </ScrollArea>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleSave}>Save Setup</Button>
      </DialogFooter>
    </>
  );
}

export function ProjectSetupPanel({
  open,
  onOpenChange,
  onSave,
  defaultValues,
  defaultStatus,
  vpnPlatforms = [],
}: ProjectSetupPanelProps) {
  const formKey = JSON.stringify({
    defaultStatus: defaultStatus ?? "",
    defaultValues,
    vpnPlatforms: vpnPlatforms.map((platform) => ({
      id: platform.id,
      label: platform.label,
    })),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] bg-[#121722] border-[#252b3a] text-slate-200">
        <ProjectSetupForm
          key={formKey}
          defaultStatus={defaultStatus}
          defaultValues={defaultValues}
          onOpenChange={onOpenChange}
          onSave={onSave}
          vpnPlatforms={vpnPlatforms}
        />
      </DialogContent>
    </Dialog>
  );
}
