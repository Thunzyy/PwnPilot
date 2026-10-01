import { api } from "./client";
import type { ProjectContextState } from "@/lib/projectContext";

export interface ProjectContextImportResponse {
  context: Partial<ProjectContextState>;
  source: string;
  messages: string[];
}

export async function importProjectContextMetadata(url: string) {
  const response = await api.post<ProjectContextImportResponse>(
    "/projects/context/import-url",
    { url }
  );
  return response.data;
}
