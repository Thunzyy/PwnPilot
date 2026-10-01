import { api } from "./client";
import type { Project, ProjectVpnStatus, UpdateProjectInput } from "@/types";

export const projectQueryKeys = {
  all: ["projects"] as const,
  detail: (projectId: string) => ["projects", projectId] as const,
  vpnStatus: (projectId: string) => ["projects", projectId, "vpn-status"] as const,
};

export type ProjectMembershipStatus = "active" | "pending" | "denied" | "none";

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

export interface ProjectAccessErrorState {
  code: string;
  message: string;
  membershipStatus: ProjectMembershipStatus;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

export const getApiErrorStatus = (error: unknown): number | null => {
  if (!isRecord(error)) {
    return null;
  }

  const response = isRecord(error.response) ? error.response : null;
  return typeof response?.status === "number" ? response.status : null;
};

export const getProjectAccessErrorState = (
  error: unknown
): ProjectAccessErrorState | null => {
  const status = getApiErrorStatus(error);
  if (status !== 403 || !isRecord(error)) {
    return null;
  }

  const response = isRecord(error.response) ? error.response : null;
  if (!response) {
    return null;
  }

  const data = isRecord(response.data)
    ? (response.data as ApiErrorEnvelope)
    : null;
  const apiError = data?.error;
  if (!apiError || apiError.code !== "8006:AUTH_FORBIDDEN") {
    return null;
  }

  const membershipStatus =
    typeof apiError.details?.membership_status === "string"
      ? (apiError.details.membership_status as ProjectMembershipStatus)
      : "none";

  return {
    code: apiError.code,
    message: apiError.message ?? "Access denied",
    membershipStatus,
  };
};

export async function fetchProjects() {
  const response = await api.get<Project[]>("/projects");
  return response.data;
}

export async function fetchProject(projectId: string) {
  const response = await api.get<Project>(`/projects/${projectId}`);
  return response.data;
}

export async function requestProjectAccess(projectId: string) {
  const response = await api.post<{
    id: string;
    status: ProjectMembershipStatus;
    role: string;
    source: string;
  }>(`/projects/${projectId}/access-requests`);
  return response.data;
}

export async function createProject(
  name: string,
  type = "custom",
  workspaceBase?: string | null,
) {
  const response = await api.post<Project>("/projects", {
    name,
    type,
    workspace_base: workspaceBase ?? undefined,
  });
  return response.data;
}

export async function updateProject(projectId: string, data: UpdateProjectInput) {
  const response = await api.put<Project>(`/projects/${projectId}`, data);
  return response.data;
}

export async function fetchProjectVpnStatus(projectId: string) {
  const response = await api.get<ProjectVpnStatus>(`/projects/${projectId}/vpn-status`);
  return response.data;
}

export async function deleteProject(projectId: string) {
  await api.delete(`/projects/${projectId}`);
  return projectId;
}
