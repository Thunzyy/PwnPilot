import { kbApi } from "./kb";

export const kbSourceQueryKeys = {
  list: (projectId?: string | null) => ["kb", "sources", projectId ?? "global"] as const,
};

export const fetchKBSources = (projectId?: string | null) =>
  kbApi.listSources(projectId ?? undefined);

export function mapKBSourcesError(err: unknown) {
  const message = "Failed to load KB sources";

  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { status?: number } }).response;
    if (response?.status === 401) {
      return "Session expired. Please refresh the page.";
    }
    if (response?.status) {
      return `Server error (${response.status}). Try again.`;
    }
    return message;
  }

  if (err && typeof err === "object" && "request" in err) {
    return "Cannot reach the server. Is the backend running?";
  }

  return message;
}
