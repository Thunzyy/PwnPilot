import type {
  Project,
  ProjectType,
  Settings,
  VpnPlatformProfile,
} from "@/types";

export const VPN_PLATFORM_ORDER: ProjectType[] = [
  "htb",
  "thm",
  "real",
  "ctf",
  "custom",
];

export const DEFAULT_VPN_CONNECT_COMMAND = "sudo openvpn {{vpn_path}}";

export const VPN_PLATFORM_META: Record<
  ProjectType,
  { label: string; shortLabel: string; description: string }
> = {
  htb: {
    label: "Hack The Box",
    shortLabel: "HTB",
    description: "Default VPN for HTB labs and machines.",
  },
  thm: {
    label: "TryHackMe",
    shortLabel: "THM",
    description: "Default VPN for TryHackMe rooms and networks.",
  },
  real: {
    label: "Real Engagement",
    shortLabel: "Client",
    description: "Client or internal VPN used for real engagements.",
  },
  ctf: {
    label: "CTF / Event",
    shortLabel: "CTF",
    description: "VPN profile for competitions and live events.",
  },
  custom: {
    label: "Custom / Misc",
    shortLabel: "Custom",
    description: "Fallback VPN profile for anything outside the presets.",
  },
};

export interface NormalizedVpnPlatformProfile {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  config_path: string;
  connect_command: string;
  file_name: string;
  managed: boolean;
  disabled: boolean;
  isBuiltIn: boolean;
  has_api_token: boolean;
}

export interface ResolvedProjectVpnConnection {
  buttonLabel: string;
  command: string | null;
  configPath: string;
  connectCommand: string;
  sourceLabel: string;
  reason: string | null;
}

const trimValue = (value?: string | null) => value?.trim() ?? "";

const humanizePlatformId = (value: string) =>
  value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "VPN Platform";

const normalizePlatformId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "custom-platform";

const getPlatformMeta = (platformId: string) => {
  if (platformId in VPN_PLATFORM_META) {
    return VPN_PLATFORM_META[platformId as ProjectType];
  }

  return {
    label: humanizePlatformId(platformId),
    shortLabel: humanizePlatformId(platformId),
    description: `Managed VPN profile for ${humanizePlatformId(platformId)}.`,
  };
};

export const normalizeVpnPlatformProfile = (
  platformId: string,
  profile?: VpnPlatformProfile | null,
  fallback?: Partial<NormalizedVpnPlatformProfile>
): NormalizedVpnPlatformProfile => {
  const normalizedId = normalizePlatformId(platformId);
  const meta = getPlatformMeta(normalizedId);
  const isBuiltIn = VPN_PLATFORM_ORDER.includes(normalizedId as ProjectType);
  const resolvedLabel =
    trimValue(profile?.label) || fallback?.label || meta.label;

  return {
    id: normalizedId,
    label: resolvedLabel,
    shortLabel:
      fallback?.shortLabel ||
      (isBuiltIn ? meta.shortLabel : resolvedLabel),
    description: fallback?.description || meta.description,
    config_path: trimValue(profile?.config_path) || fallback?.config_path || "",
    connect_command:
      trimValue(profile?.connect_command) ||
      fallback?.connect_command ||
      DEFAULT_VPN_CONNECT_COMMAND,
    file_name: trimValue(profile?.file_name) || fallback?.file_name || "",
    managed: profile?.managed === true || fallback?.managed === true,
    disabled: profile?.disabled === true || fallback?.disabled === true,
    isBuiltIn: fallback?.isBuiltIn === true || isBuiltIn,
    has_api_token: profile?.has_api_token === true,
  };
};

interface VpnPlatformOptions {
  includeDisabled?: boolean;
}

export const getVpnPlatformDefaults = (
  settings?: Settings | null,
  options?: VpnPlatformOptions
): Record<string, NormalizedVpnPlatformProfile> => {
  const storedDefaults = settings?.vpn_platform_defaults ?? {};
  const normalized: Record<string, NormalizedVpnPlatformProfile> = {};
  const includeDisabled = options?.includeDisabled === true;

  const disabledPlatformIds = new Set(
    Object.entries(storedDefaults)
      .filter(([, profile]) => profile?.disabled === true)
      .map(([platformId]) => normalizePlatformId(platformId))
  );

  VPN_PLATFORM_ORDER.forEach((platformId) => {
    if (!includeDisabled && disabledPlatformIds.has(platformId)) {
      return;
    }

    normalized[platformId] = normalizeVpnPlatformProfile(
      platformId,
      storedDefaults[platformId],
      {
        config_path:
          platformId === "custom" ? trimValue(settings?.vpn_path) : "",
        connect_command: DEFAULT_VPN_CONNECT_COMMAND,
        disabled: disabledPlatformIds.has(platformId),
        isBuiltIn: true,
      }
    );
  });

  Object.entries(storedDefaults).forEach(([platformId, profile]) => {
    const normalizedId = normalizePlatformId(platformId);
    if (profile?.disabled === true && !includeDisabled) {
      return;
    }

    if (normalizedId in normalized) {
      normalized[normalizedId] = normalizeVpnPlatformProfile(
        normalizedId,
        profile,
        {
          ...normalized[normalizedId],
          disabled:
            profile?.disabled === true || normalized[normalizedId].disabled,
          isBuiltIn: VPN_PLATFORM_ORDER.includes(normalizedId as ProjectType),
        }
      );
      return;
    }

    normalized[normalizedId] = normalizeVpnPlatformProfile(normalizedId, profile, {
      connect_command: DEFAULT_VPN_CONNECT_COMMAND,
      disabled: profile?.disabled === true,
      isBuiltIn: false,
    });
  });

  return normalized;
};

export const getVpnPlatformList = (
  settings?: Settings | null,
  options?: VpnPlatformOptions
): NormalizedVpnPlatformProfile[] => {
  const registry = getVpnPlatformDefaults(settings, options);
  const extraPlatforms = Object.values(registry)
    .filter((platform) => !platform.isBuiltIn)
    .sort((left, right) => left.label.localeCompare(right.label));

  return [
    ...VPN_PLATFORM_ORDER.map((platformId) => registry[platformId]).filter(Boolean),
    ...extraPlatforms,
  ].filter(Boolean);
};

const renderTemplate = (
  template: string,
  variables: Record<string, string>
) =>
  template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return variables[key] ?? "";
  });

export const resolveProjectVpnConnection = (
  project: Pick<Project, "name" | "slug" | "workspace_path" | "type" | "variables">,
  settings?: Settings | null
): ResolvedProjectVpnConnection => {
  const registry = getVpnPlatformDefaults(settings);
  const requestedPlatformId = normalizePlatformId(
    trimValue(project.variables.vpn_platform) || project.type
  );
  const selectedPlatform = registry[requestedPlatformId] ?? registry[project.type];
  const fallbackMeta = getPlatformMeta(project.type);

  const projectPath = trimValue(project.variables.vpn_path);
  const platformPath = trimValue(selectedPlatform?.config_path);
  const legacyPath = trimValue(settings?.vpn_path);
  const configPath = projectPath || platformPath || legacyPath;

  const connectCommand =
    trimValue(project.variables.vpn_connect_command) ||
    trimValue(selectedPlatform?.connect_command) ||
    DEFAULT_VPN_CONNECT_COMMAND;

  const platformLabel = selectedPlatform?.label || fallbackMeta.label;
  const buttonLabel = `Connect ${selectedPlatform?.shortLabel || platformLabel} VPN`;

  const sourceLabel = projectPath
    ? "project override"
    : platformPath
    ? `${platformLabel} default`
    : legacyPath
    ? "legacy global default"
    : "missing";

  if (!configPath) {
    return {
      buttonLabel,
      command: null,
      configPath: "",
      connectCommand,
      sourceLabel,
      reason: `Configure a VPN path or upload a VPN file for ${platformLabel} in global settings or project settings.`,
    };
  }

  const command = renderTemplate(connectCommand, {
    vpn_path: configPath,
    project_name: project.name,
    project_slug: project.slug,
    project_path: project.workspace_path,
    project_type: project.type,
  }).trim();

  return {
    buttonLabel,
    command: command || null,
    configPath,
    connectCommand,
    sourceLabel,
    reason: command ? null : "VPN connect command is empty.",
  };
};
