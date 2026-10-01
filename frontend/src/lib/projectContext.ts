import type { ProjectVariables } from "@/types";

export type ProjectEngagementKind = "platform_lab" | "ctf" | "practice";

export interface ProjectContextState {
  engagement_kind: string;
  platform_name: string;
  platform_url: string;
  platform_content_type: string;
  platform_target_name: string;
  platform_target_slug: string;
  platform_difficulty: string;
  target_ip: string;
  target_domain: string;
  os: string;
  scope: string;
  objective: string;
  constraints: string;
  notes: string;
  ai_briefing: string;
}

export const PROJECT_CONTEXT_KEYS = [
  "engagement_kind",
  "platform_name",
  "platform_url",
  "platform_content_type",
  "platform_target_name",
  "platform_target_slug",
  "platform_difficulty",
  "target_ip",
  "target_domain",
  "os",
  "scope",
  "objective",
  "constraints",
  "notes",
  "ai_briefing",
] as const;

export const PROJECT_CONTEXT_DEFAULTS: ProjectContextState = {
  engagement_kind: "practice",
  platform_name: "",
  platform_url: "",
  platform_content_type: "",
  platform_target_name: "",
  platform_target_slug: "",
  platform_difficulty: "",
  target_ip: "",
  target_domain: "",
  os: "",
  scope: "",
  objective: "",
  constraints: "",
  notes: "",
  ai_briefing: "",
};

const TRY_HACK_ME_HOSTS = new Set(["tryhackme.com", "www.tryhackme.com"]);
const HACK_THE_BOX_HOSTS = new Set([
  "hackthebox.com",
  "www.hackthebox.com",
  "app.hackthebox.com",
  "academy.hackthebox.com",
  "ctf.hackthebox.com",
]);

const trimValue = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const humanizeSlug = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
};

const buildHostLabel = (host: string): string => {
  const hostname = host.replace(/^www\./, "").trim().toLowerCase();
  if (!hostname) return "";
  const label = hostname.split(".")[0] ?? hostname;
  return humanizeSlug(label);
};

const buildImportResult = (
  next: Partial<ProjectContextState>
): ProjectContextState => ({
  ...PROJECT_CONTEXT_DEFAULTS,
  ...next,
});

const mergeNonEmptyContext = (
  base: ProjectContextState,
  patch: Partial<ProjectContextState>
): ProjectContextState => {
  const next = { ...base };
  for (const key of PROJECT_CONTEXT_KEYS) {
    const value = trimValue(patch[key]);
    if (value) {
      next[key] = value;
    }
  }
  return next;
};

const getPathSegments = (value: URL): string[] =>
  value.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

export function importProjectContextFromUrl(rawUrl: string): ProjectContextState {
  const normalizedUrl = trimValue(rawUrl);
  if (!normalizedUrl) {
    return { ...PROJECT_CONTEXT_DEFAULTS };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    return buildImportResult({
      platform_url: normalizedUrl,
    });
  }

  const host = parsedUrl.hostname.toLowerCase();
  const segments = getPathSegments(parsedUrl);

  if (TRY_HACK_ME_HOSTS.has(host)) {
    const roomIndex = segments.findIndex((segment) => segment === "room");
    const roomCode = roomIndex >= 0 ? segments[roomIndex + 1] ?? "" : "";
    return buildImportResult({
      engagement_kind: "platform_lab",
      platform_name: "TryHackMe",
      platform_url: parsedUrl.toString(),
      platform_content_type: roomCode ? "room" : "",
      platform_target_slug: roomCode,
      platform_target_name: roomCode ? humanizeSlug(roomCode) : "",
    });
  }

  if (HACK_THE_BOX_HOSTS.has(host)) {
    const normalizedSegments = segments.map((segment) => segment.toLowerCase());
    const ctfIndex = normalizedSegments.findIndex((segment) => segment === "ctf");
    const machineIndex = normalizedSegments.findIndex(
      (segment) => segment === "machine" || segment === "machines"
    );
    const challengeIndex = normalizedSegments.findIndex(
      (segment) => segment === "challenge" || segment === "challenges"
    );

    if (ctfIndex >= 0) {
      return buildImportResult({
        engagement_kind: "ctf",
        platform_name: "Hack The Box",
        platform_url: parsedUrl.toString(),
        platform_content_type: "ctf",
      });
    }

    if (machineIndex >= 0) {
      const slug = segments[machineIndex + 1] ?? "";
      return buildImportResult({
        engagement_kind: "platform_lab",
        platform_name: "Hack The Box",
        platform_url: parsedUrl.toString(),
        platform_content_type: "machine",
        platform_target_slug: slug,
        platform_target_name: humanizeSlug(slug),
      });
    }

    if (challengeIndex >= 0) {
      const slug = segments[challengeIndex + 1] ?? "";
      return buildImportResult({
        engagement_kind: "practice",
        platform_name: "Hack The Box",
        platform_url: parsedUrl.toString(),
        platform_content_type: "challenge",
        platform_target_slug: slug,
        platform_target_name: humanizeSlug(slug),
      });
    }

    return buildImportResult({
      engagement_kind: host === "ctf.hackthebox.com" ? "ctf" : "platform_lab",
      platform_name:
        host === "academy.hackthebox.com"
          ? "Hack The Box Academy"
          : "Hack The Box",
      platform_url: parsedUrl.toString(),
    });
  }

  return buildImportResult({
    engagement_kind: "practice",
    platform_name: buildHostLabel(host),
    platform_url: parsedUrl.toString(),
  });
}

export function buildProjectContextState(
  variables: ProjectVariables = {}
): ProjectContextState {
  const nextState = { ...PROJECT_CONTEXT_DEFAULTS };
  for (const key of PROJECT_CONTEXT_KEYS) {
    nextState[key] = trimValue(variables[key]);
  }
  return nextState;
}

export function mergeImportedProjectContext(
  current: ProjectContextState,
  imported: Partial<ProjectContextState>
): ProjectContextState {
  const merged = mergeNonEmptyContext({ ...current }, imported);
  return {
    ...current,
    ...merged,
    platform_url: trimValue(current.platform_url) || trimValue(imported.platform_url),
    target_ip: trimValue(current.target_ip) || trimValue(imported.target_ip),
    target_domain:
      trimValue(current.target_domain) || trimValue(imported.target_domain),
    os: trimValue(current.os) || trimValue(imported.os),
    scope: trimValue(current.scope) || trimValue(imported.scope),
    objective: trimValue(current.objective) || trimValue(imported.objective),
    constraints:
      trimValue(current.constraints) || trimValue(imported.constraints),
    notes: trimValue(current.notes) || trimValue(imported.notes),
    ai_briefing:
      trimValue(current.ai_briefing) || trimValue(imported.ai_briefing),
  };
}

export function mergeProjectContextIntoVariables(
  state: ProjectContextState,
  baseVariables: ProjectVariables = {}
): ProjectVariables {
  const nextVariables: ProjectVariables = { ...baseVariables };

  for (const key of PROJECT_CONTEXT_KEYS) {
    delete nextVariables[key];
  }

  for (const key of PROJECT_CONTEXT_KEYS) {
    const value = trimValue(state[key]);
    if (value) {
      nextVariables[key] = value;
    }
  }

  return nextVariables;
}
