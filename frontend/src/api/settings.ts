import { api } from "./client";
import type { Settings } from "@/types";

export const settingsQueryKeys = {
  current: ["settings"] as const,
};

export async function fetchSettings() {
  const response = await api.get<Settings>("/settings");
  return response.data;
}

export async function updateSettings(updates: Settings) {
  const response = await api.put<Settings>("/settings", updates);
  return response.data;
}
