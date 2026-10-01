import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Upload } from "lucide-react";

import { fetchSettings, settingsQueryKeys } from "@/api/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_VPN_CONNECT_COMMAND,
  getVpnPlatformList,
} from "@/lib/vpn";
import { useAuthStore } from "@/stores/authStore";
import { DEFAULT_WORKSPACE_BASE, useSettingsStore } from "@/stores/settingsStore";

import { SystemPromptSelector } from "./SystemPromptSelector";
import { VaultPathInput } from "./VaultPathInput";

type AuthStoreState = ReturnType<typeof useAuthStore.getState>;
type SettingsStoreState = ReturnType<typeof useSettingsStore.getState>;

const sectionTitleClassName =
  "text-xs uppercase tracking-[0.28em] text-slate-500";
const fieldLabelClassName =
  "text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400";
const fieldHintClassName = "text-xs text-slate-500";

interface OperatorVpnPlatformState {
  rowId: string;
  id: string;
  label: string;
  description: string;
  config_path: string;
  managed_path_snapshot: string;
  connect_command: string;
  file_name: string;
  managed: boolean;
  disabled: boolean;
  isBuiltIn: boolean;
  uploaded_file_name: string;
  uploaded_file_content: string;
  api_token: string;
  has_api_token: boolean;
  clear_api_token: boolean;
}

interface OperatorSettingsFormState {
  displayName: string;
  team: string;
  timezone: string;
  signature: string;
  workspaceBase: string;
  vaultPath: string;
  reportEvaluationLeaseSeconds: string;
  reportEvaluationHeartbeatIntervalSeconds: string;
  reportEvaluationReclaimPollIntervalSeconds: string;
  reportEvaluationMaxRuntimeSeconds: string;
  vpnPlatforms: OperatorVpnPlatformState[];
}

const toOptionalNumberString = (value: number | null | undefined) =>
  value == null ? "" : String(value);

const parseOptionalNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizePlatformId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "custom-platform";

const humanizePlatformId = (value: string) =>
  normalizePlatformId(value)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "VPN Platform";

const createRowId = () => `vpn-platform-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const toFormPlatform = (
  platform: ReturnType<typeof getVpnPlatformList>[number],
  settings?: SettingsStoreState["settings"]
): OperatorVpnPlatformState => ({
  rowId: createRowId(),
  id: platform.id,
  label: platform.label,
  description: platform.description,
  config_path: platform.config_path,
  managed_path_snapshot: platform.managed ? platform.config_path : "",
  connect_command: platform.connect_command,
  file_name: platform.file_name,
  managed: platform.managed,
  disabled: platform.disabled,
  isBuiltIn: platform.isBuiltIn,
  uploaded_file_name: "",
  uploaded_file_content: "",
  api_token: "",
  has_api_token:
    platform.has_api_token ||
    settings?.vpn_platform_defaults?.[platform.id]?.has_api_token === true,
  clear_api_token: false,
});

const buildFormState = (
  user: AuthStoreState["user"],
  settings: SettingsStoreState["settings"]
): OperatorSettingsFormState => ({
  displayName: user?.display_name || "",
  team: user?.team || "",
  timezone: user?.timezone || "",
  signature: user?.signature || "",
  workspaceBase: settings?.workspace_base_path || DEFAULT_WORKSPACE_BASE,
  vaultPath: settings?.vault_path || "",
  reportEvaluationLeaseSeconds: toOptionalNumberString(
    settings?.report_evaluation_lease_seconds
  ),
  reportEvaluationHeartbeatIntervalSeconds: toOptionalNumberString(
    settings?.report_evaluation_heartbeat_interval_seconds
  ),
  reportEvaluationReclaimPollIntervalSeconds: toOptionalNumberString(
    settings?.report_evaluation_reclaim_poll_interval_seconds
  ),
  reportEvaluationMaxRuntimeSeconds: toOptionalNumberString(
    settings?.report_evaluation_max_runtime_seconds
  ),
  vpnPlatforms: getVpnPlatformList(settings, { includeDisabled: true }).map(
    (platform) => toFormPlatform(platform, settings)
  ),
});

const readFileAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

const buildVpnPlatformDefaultsPayload = (
  vpnPlatforms: OperatorVpnPlatformState[]
) =>
  vpnPlatforms.reduce(
    (acc, platform) => {
      const platformId = normalizePlatformId(platform.id);
      acc[platformId] = {
        label: platform.label.trim() || humanizePlatformId(platformId),
        config_path: platform.disabled ? "" : platform.config_path.trim(),
        connect_command:
          platform.connect_command.trim() || DEFAULT_VPN_CONNECT_COMMAND,
        file_name: platform.disabled ? undefined : platform.file_name.trim() || undefined,
        managed:
          !platform.disabled &&
          (Boolean(platform.uploaded_file_content.trim()) ||
            (platform.managed &&
              platform.config_path.trim() ===
                platform.managed_path_snapshot.trim())),
        disabled: platform.disabled,
        uploaded_file_name:
          platform.disabled ? undefined : platform.uploaded_file_name.trim() || undefined,
        uploaded_file_content:
          platform.disabled ? undefined : platform.uploaded_file_content || undefined,
        api_token:
          platform.disabled ? undefined : platform.api_token.trim() || undefined,
        clear_api_token:
          platform.clear_api_token && !platform.api_token.trim() ? true : undefined,
      };
      return acc;
    },
    {} as Record<string, Record<string, string | boolean | undefined>>
  );

function VpnPlatformCard({
  platform,
  onChange,
  onDelete,
  onFileSelected,
}: {
  platform: OperatorVpnPlatformState;
  onChange: (
    rowId: string,
    field: keyof OperatorVpnPlatformState,
    value: string | boolean
  ) => void;
  onDelete: (rowId: string) => void;
  onFileSelected: (rowId: string, file: File) => Promise<void>;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = `vpn-file-${platform.rowId}`;

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await onFileSelected(platform.rowId, file);
  };

  const handleFileInputChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await onFileSelected(platform.rowId, file);
    event.target.value = "";
  };

  const uploadStateLabel = platform.uploaded_file_name
    ? `Selected file: ${platform.uploaded_file_name}`
    : platform.managed && platform.file_name
    ? `Stored file: ${platform.file_name}`
    : platform.config_path
    ? `Using path: ${platform.config_path}`
    : "Drop a .ovpn file here or choose one from disk.";
  const tokenPlaceholder = platform.has_api_token
    ? "Leave empty to keep the stored token"
    : "Paste a platform API token or leave empty to keep the stored token";
  const handleTokenInput = (value: string) => {
    onChange(platform.rowId, "api_token", value);
    if (value.trim()) {
      onChange(platform.rowId, "clear_api_token", false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/6 bg-[#0d1523] p-5 shadow-[0_20px_60px_rgba(2,6,23,0.3)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{platform.label}</h3>
          <p className="mt-1 text-sm text-slate-400">{platform.description}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"
          onClick={() => onDelete(platform.rowId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete Platform
        </Button>
      </div>

      <div className="mt-5 grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor={`vpn-platform-name-${platform.rowId}`} className={fieldLabelClassName}>
              Platform Name
            </label>
            <Input
              id={`vpn-platform-name-${platform.rowId}`}
              value={platform.label}
              onChange={(event) =>
                onChange(platform.rowId, "label", event.target.value)
              }
              className="border-white/10 bg-black/30 text-slate-100"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={`vpn-platform-id-${platform.rowId}`} className={fieldLabelClassName}>
              Platform ID
            </label>
            <Input
              id={`vpn-platform-id-${platform.rowId}`}
              value={platform.id}
              onChange={(event) =>
                onChange(platform.rowId, "id", normalizePlatformId(event.target.value))
              }
              readOnly={platform.isBuiltIn}
              className="border-white/10 bg-black/30 font-mono text-slate-100"
            />
            <p className={fieldHintClassName}>
              Used by projects to resolve the one-click VPN profile.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`vpn-platform-path-${platform.rowId}`} className={fieldLabelClassName}>
            Config path
          </label>
          <Input
            id={`vpn-platform-path-${platform.rowId}`}
            value={platform.config_path}
            onChange={(event) =>
              onChange(platform.rowId, "config_path", event.target.value)
            }
            placeholder="/vpn/client.ovpn"
            className="border-white/10 bg-black/30 text-slate-100"
          />
          <p className={fieldHintClassName}>
            Leave this as-is to keep the managed uploaded file, or enter a manual path to override it.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`vpn-platform-command-${platform.rowId}`} className={fieldLabelClassName}>
            Connect command
          </label>
          <Input
            id={`vpn-platform-command-${platform.rowId}`}
            value={platform.connect_command}
            onChange={(event) =>
              onChange(platform.rowId, "connect_command", event.target.value)
            }
            placeholder={DEFAULT_VPN_CONNECT_COMMAND}
            className="border-white/10 bg-black/30 font-mono text-slate-100"
          />
          <p className={fieldHintClassName}>
            Tokens available: <code>{"{{vpn_path}}"}</code>,{" "}
            <code>{"{{project_slug}}"}</code>, <code>{"{{project_path}}"}</code>.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor={`vpn-platform-token-${platform.rowId}`}
              className={fieldLabelClassName}
            >
              API token
            </label>
            {platform.has_api_token || platform.api_token ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/10 bg-black/20 text-slate-200"
                onClick={() => {
                  onChange(platform.rowId, "api_token", "");
                  onChange(platform.rowId, "clear_api_token", true);
                  onChange(platform.rowId, "has_api_token", false);
                }}
              >
                Clear Token
              </Button>
            ) : null}
          </div>
          <Input
            id={`vpn-platform-token-${platform.rowId}`}
            type="password"
            value={platform.api_token}
            onChange={(event) =>
              handleTokenInput((event.target as HTMLInputElement).value)
            }
            placeholder={tokenPlaceholder}
            className="border-white/10 bg-black/30 text-slate-100"
          />
          <p className={fieldHintClassName}>
            Stored encrypted on the backend and used for platform metadata imports.
          </p>
        </div>

        <div
          className={`rounded-2xl border border-dashed p-4 transition-colors ${
            isDragOver
              ? "border-cyan-300/60 bg-cyan-400/10"
              : "border-white/10 bg-black/20"
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setIsDragOver(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragOver(false);
          }}
          onDrop={(event) => void handleDrop(event)}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">VPN file</p>
              <p className="mt-1 text-sm text-slate-400">{uploadStateLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                id={fileInputId}
                ref={fileInputRef}
                type="file"
                accept=".ovpn,.conf,.cfg,.txt"
                className="hidden"
                aria-label="Choose VPN File"
                onChange={(event) => void handleFileInputChange(event)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/10 bg-black/30 text-slate-100"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Choose File
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function OperatorSettingsForm({
  user,
  settings,
  updateProfile,
  updateSettings,
  isBusy,
  error,
}: {
  user: AuthStoreState["user"];
  settings: SettingsStoreState["settings"];
  updateProfile: AuthStoreState["updateProfile"];
  updateSettings: SettingsStoreState["updateSettings"];
  isBusy: boolean;
  error: string | null;
}) {
  const [formState, setFormState] = useState<OperatorSettingsFormState>(() =>
    buildFormState(user, settings)
  );
  const formStateRef = useRef(formState);
  const updateFormState = (
    updater: (previous: OperatorSettingsFormState) => OperatorSettingsFormState
  ) => {
    setFormState((previous) => {
      const next = updater(previous);
      formStateRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  const persistVpnPlatforms = async (
    vpnPlatforms: OperatorVpnPlatformState[]
  ) => {
    await updateSettings({
      workspace_base_path: settings?.workspace_base_path || "",
      vault_path: settings?.vault_path || "",
      vpn_path: settings?.vpn_path || "",
      vpn_content: settings?.vpn_content || "",
      report_evaluation_lease_seconds:
        settings?.report_evaluation_lease_seconds ?? null,
      report_evaluation_heartbeat_interval_seconds:
        settings?.report_evaluation_heartbeat_interval_seconds ?? null,
      report_evaluation_reclaim_poll_interval_seconds:
        settings?.report_evaluation_reclaim_poll_interval_seconds ?? null,
      report_evaluation_max_runtime_seconds:
        settings?.report_evaluation_max_runtime_seconds ?? null,
      vpn_platform_defaults: buildVpnPlatformDefaultsPayload(vpnPlatforms),
    });
  };

  const updateVpnPlatform = (
    rowId: string,
    field: keyof OperatorVpnPlatformState,
    value: string | boolean
  ) => {
    updateFormState((prev) => ({
      ...prev,
      vpnPlatforms: prev.vpnPlatforms.map((platform) => {
        if (platform.rowId !== rowId) return platform;

        if (field === "config_path" && typeof value === "string") {
          return {
            ...platform,
            config_path: value,
            managed:
              platform.managed_path_snapshot.trim() !== "" &&
              value.trim() === platform.managed_path_snapshot.trim(),
            file_name: value.trim() ? "" : platform.file_name,
            uploaded_file_name: value.trim() ? "" : platform.uploaded_file_name,
            uploaded_file_content: value.trim()
              ? ""
              : platform.uploaded_file_content,
          };
        }

        return {
          ...platform,
          [field]: value,
          ...(field === "api_token"
            ? { clear_api_token: false }
            : {}),
        };
      }),
    }));
  };

  const addVpnPlatform = () => {
    const nextIndex = formState.vpnPlatforms.filter(
      (platform) => !platform.isBuiltIn && !platform.disabled
    ).length + 1;
    const platformId = normalizePlatformId(`platform-${nextIndex}`);

    updateFormState((prev) => ({
      ...prev,
      vpnPlatforms: [
        ...prev.vpnPlatforms,
        {
          rowId: createRowId(),
          id: platformId,
          label: humanizePlatformId(platformId),
          description: "Custom VPN platform managed from global settings.",
          config_path: "",
          managed_path_snapshot: "",
          connect_command: DEFAULT_VPN_CONNECT_COMMAND,
          file_name: "",
          managed: false,
          disabled: false,
          isBuiltIn: false,
          uploaded_file_name: "",
          uploaded_file_content: "",
          api_token: "",
          has_api_token: false,
          clear_api_token: false,
        },
      ],
    }));
  };

  const removeVpnPlatform = (rowId: string) => {
    const targetPlatform = formState.vpnPlatforms.find(
      (platform) => platform.rowId === rowId
    );
    if (!targetPlatform) {
      return;
    }

    const nextPlatforms = targetPlatform.isBuiltIn
      ? formState.vpnPlatforms.map((platform) =>
          platform.rowId === rowId
            ? {
                ...platform,
                config_path: "",
                managed_path_snapshot: "",
                file_name: "",
                managed: false,
                disabled: true,
                uploaded_file_name: "",
                uploaded_file_content: "",
              }
            : platform
        )
      : formState.vpnPlatforms.filter((platform) => platform.rowId !== rowId);

    updateFormState((prev) => ({
      ...prev,
      vpnPlatforms: nextPlatforms,
    }));
    void persistVpnPlatforms(nextPlatforms);
  };

  const handleVpnFileSelected = async (rowId: string, file: File) => {
    const content = await readFileAsText(file);
    const nextPlatforms = formState.vpnPlatforms.map((platform) =>
      platform.rowId === rowId
        ? {
            ...platform,
            config_path: "",
            managed_path_snapshot: "",
            file_name: file.name,
            managed: true,
            uploaded_file_name: file.name,
            uploaded_file_content: content,
          }
        : platform
    );

    updateFormState((prev) => ({
      ...prev,
      vpnPlatforms: nextPlatforms,
    }));
    await persistVpnPlatforms(nextPlatforms);
  };

  const handleSave = async () => {
    const currentState = formStateRef.current;
    await updateProfile({
      display_name: currentState.displayName,
      team: currentState.team,
      timezone: currentState.timezone,
      signature: currentState.signature,
    });

    await updateSettings({
      workspace_base_path: currentState.workspaceBase,
      vault_path: currentState.vaultPath,
      vpn_path: settings?.vpn_path || "",
      vpn_content: settings?.vpn_content || "",
      report_evaluation_lease_seconds: parseOptionalNumber(
        currentState.reportEvaluationLeaseSeconds
      ),
      report_evaluation_heartbeat_interval_seconds: parseOptionalNumber(
        currentState.reportEvaluationHeartbeatIntervalSeconds
      ),
      report_evaluation_reclaim_poll_interval_seconds: parseOptionalNumber(
        currentState.reportEvaluationReclaimPollIntervalSeconds
      ),
      report_evaluation_max_runtime_seconds: parseOptionalNumber(
        currentState.reportEvaluationMaxRuntimeSeconds
      ),
      vpn_platform_defaults: buildVpnPlatformDefaultsPayload(currentState.vpnPlatforms),
    });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/6 bg-[#121722] p-6 shadow-[0_25px_80px_rgba(2,6,23,0.45)] lg:p-8">
        <div className="flex flex-col gap-3 border-b border-white/6 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className={sectionTitleClassName}>Operator Console</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Global workspace and platform defaults
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Define the operator profile, workspace paths, AI defaults, and
              platform VPN profiles used to bootstrap projects and trigger a
              one-click VPN connection.
            </p>
          </div>
          <Button onClick={handleSave} disabled={isBusy} className="min-w-36">
            {isBusy ? "Saving..." : "Save Settings"}
          </Button>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
          <section className="rounded-2xl border border-white/6 bg-[#0d1523] p-5">
            <div className={sectionTitleClassName}>Profile</div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="operator-username" className={fieldLabelClassName}>
                  Username
                </label>
                <Input
                  id="operator-username"
                  value={user?.username || ""}
                  readOnly
                  className="border-white/10 bg-black/30 text-slate-400"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="operator-email" className={fieldLabelClassName}>
                  Email
                </label>
                <Input
                  id="operator-email"
                  value={user?.email || "Email not set"}
                  readOnly
                  className="border-white/10 bg-black/30 text-slate-400"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="display-name" className={fieldLabelClassName}>
                  Display name
                </label>
                <Input
                  id="display-name"
                  value={formState.displayName}
                  onChange={(event) =>
                    updateFormState((prev) => ({
                      ...prev,
                      displayName: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="team" className={fieldLabelClassName}>
                  Team
                </label>
                <Input
                  id="team"
                  value={formState.team}
                  onChange={(event) =>
                    updateFormState((prev) => ({
                      ...prev,
                      team: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="timezone" className={fieldLabelClassName}>
                  Timezone
                </label>
                <Input
                  id="timezone"
                  value={formState.timezone}
                  onChange={(event) =>
                    updateFormState((prev) => ({
                      ...prev,
                      timezone: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="signature" className={fieldLabelClassName}>
                  Signature
                </label>
                <Input
                  id="signature"
                  value={formState.signature}
                  onChange={(event) =>
                    updateFormState((prev) => ({
                      ...prev,
                      signature: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/6 bg-[#0d1523] p-5">
            <div className={sectionTitleClassName}>Workspace</div>
            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="workspace-base" className={fieldLabelClassName}>
                  Workspace base path
                </label>
                <Input
                  id="workspace-base"
                  value={formState.workspaceBase}
                  onChange={(event) =>
                    updateFormState((prev) => ({
                      ...prev,
                      workspaceBase: event.target.value,
                    }))
                  }
                  className="border-white/10 bg-black/30 text-slate-100"
                />
                <p className={fieldHintClassName}>
                  Used as the default root when creating a new project workspace.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className={fieldLabelClassName}>Knowledge base vault</label>
                <VaultPathInput
                  value={formState.vaultPath}
                  onChange={(value) =>
                    updateFormState((prev) => ({ ...prev, vaultPath: value }))
                  }
                />
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-white/6 bg-[#0d1523] p-5">
          <div className={sectionTitleClassName}>Global AI Prompt</div>
          <div className="mt-4 rounded-xl border border-white/6 bg-black/20 p-4">
            <SystemPromptSelector
              scope="global"
              description="Select and customize the default system prompt. This will be used for all projects unless overridden."
            />
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-white/6 bg-[#0d1523] p-5">
          <div className={sectionTitleClassName}>Report Evaluation</div>
          <div className="mt-2 max-w-3xl text-sm text-slate-400">
            Tune how long report evaluation jobs keep their lease alive before
            the backend lets another worker reclaim them.
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="report-evaluation-lease-seconds"
                className={fieldLabelClassName}
              >
                Evaluation lease duration
              </label>
              <Input
                id="report-evaluation-lease-seconds"
                type="number"
                min="1"
                step="0.1"
                value={formState.reportEvaluationLeaseSeconds}
                onChange={(event) =>
                  updateFormState((prev) => ({
                    ...prev,
                    reportEvaluationLeaseSeconds: event.target.value,
                  }))
                }
                className="border-white/10 bg-black/30 text-slate-100"
              />
              <p className={fieldHintClassName}>
                Seconds before a worker must renew its claim on a report job.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="report-evaluation-heartbeat-interval-seconds"
                className={fieldLabelClassName}
              >
                Heartbeat interval
              </label>
              <Input
                id="report-evaluation-heartbeat-interval-seconds"
                type="number"
                min="0.1"
                step="0.1"
                value={formState.reportEvaluationHeartbeatIntervalSeconds}
                onChange={(event) =>
                  updateFormState((prev) => ({
                    ...prev,
                    reportEvaluationHeartbeatIntervalSeconds: event.target.value,
                  }))
                }
                className="border-white/10 bg-black/30 text-slate-100"
              />
              <p className={fieldHintClassName}>
                How often a running evaluation renews its lease.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="report-evaluation-reclaim-poll-interval-seconds"
                className={fieldLabelClassName}
              >
                Reclaim poll interval
              </label>
              <Input
                id="report-evaluation-reclaim-poll-interval-seconds"
                type="number"
                min="0.1"
                step="0.1"
                value={formState.reportEvaluationReclaimPollIntervalSeconds}
                onChange={(event) =>
                  updateFormState((prev) => ({
                    ...prev,
                    reportEvaluationReclaimPollIntervalSeconds: event.target.value,
                  }))
                }
                className="border-white/10 bg-black/30 text-slate-100"
              />
              <p className={fieldHintClassName}>
                How often the backend looks for expired evaluation jobs to reclaim.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="report-evaluation-max-runtime-seconds"
                className={fieldLabelClassName}
              >
                Evaluation max runtime
              </label>
              <Input
                id="report-evaluation-max-runtime-seconds"
                type="number"
                min="0"
                step="1"
                value={formState.reportEvaluationMaxRuntimeSeconds}
                onChange={(event) =>
                  updateFormState((prev) => ({
                    ...prev,
                    reportEvaluationMaxRuntimeSeconds: event.target.value,
                  }))
                }
                className="border-white/10 bg-black/30 text-slate-100"
              />
              <p className={fieldHintClassName}>
                Leave empty to inherit defaults, or set 0 to disable the hard stop.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className={sectionTitleClassName}>Platform VPN Profiles</p>
              <h3 className="mt-1 text-xl font-semibold text-white">
                Explicit VPN settings per platform
              </h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-400">
                Add, edit, import, and retire VPN platforms from one place so
                every project can expose a single intuitive connect action.
              </p>
              <p className="mt-2 max-w-3xl text-xs text-slate-500">
                Any platform can be removed here. Deleting a built-in preset
                hides it from the workspace and removes its managed file.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-white/10 bg-black/20 text-slate-100"
              onClick={addVpnPlatform}
            >
              <Plus className="h-4 w-4" />
              Add Platform
            </Button>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 2xl:grid-cols-2">
            {formState.vpnPlatforms
              .filter((platform) => !platform.disabled)
              .map((platform) => (
              <VpnPlatformCard
                key={platform.rowId}
                platform={platform}
                onChange={updateVpnPlatform}
                onDelete={removeVpnPlatform}
                onFileSelected={handleVpnFileSelected}
              />
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}

export function OperatorSettings() {
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const storedSettings = useSettingsStore((state) => state.settings);
  const error = useSettingsStore((state) => state.error);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const isLoading = useSettingsStore((state) => state.isLoading);
  const settingsQuery = useQuery({
    queryKey: settingsQueryKeys.current,
    queryFn: fetchSettings,
    initialData: storedSettings ?? undefined,
  });
  const settings = settingsQuery.data ?? null;

  useEffect(() => {
    if (settings) {
      setSettings(settings);
    }
  }, [setSettings, settings]);

  const isBusy = isLoading || settingsQuery.isPending;
  const formKey = [
    user?.id ?? "anonymous",
    user?.display_name ?? "",
    user?.team ?? "",
    user?.timezone ?? "",
    user?.signature ?? "",
    settings?.workspace_base_path ?? "",
    settings?.vault_path ?? "",
    settings?.vpn_path ?? "",
    settings?.vpn_content ?? "",
    settings?.report_evaluation_lease_seconds ?? "",
    settings?.report_evaluation_heartbeat_interval_seconds ?? "",
    settings?.report_evaluation_reclaim_poll_interval_seconds ?? "",
    settings?.report_evaluation_max_runtime_seconds ?? "",
    JSON.stringify(settings?.vpn_platform_defaults ?? {}),
  ].join("|");

  return (
    <OperatorSettingsForm
      key={formKey}
      user={user}
      settings={settings}
      updateProfile={updateProfile}
      updateSettings={updateSettings}
      isBusy={isBusy}
      error={error}
    />
  );
}
