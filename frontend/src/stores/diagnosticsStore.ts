import { create } from "zustand";

import type {
  DiagnosticsCategory,
  DiagnosticsEventInput,
  DiagnosticsSeverity,
} from "@/lib/diagnostics";

export interface DiagnosticsEvent extends DiagnosticsEventInput {
  id: string;
  timestamp: string;
  count: number;
}

interface DiagnosticsState {
  events: DiagnosticsEvent[];
  recordEvent: (event: DiagnosticsEventInput) => void;
  clearEvents: () => void;
}

const MAX_DIAGNOSTICS_EVENTS = 80;
const DEDUPE_WINDOW_MS = 2500;

const createEventId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `diag-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const isSameEvent = (
  existing: DiagnosticsEvent,
  incoming: DiagnosticsEventInput,
  nowMs: number
) =>
  existing.category === incoming.category &&
  existing.title === incoming.title &&
  existing.source === incoming.source &&
  existing.status === incoming.status &&
  nowMs - Date.parse(existing.timestamp) <= DEDUPE_WINDOW_MS;

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  events: [],
  recordEvent: (event) =>
    set((state) => {
      const now = new Date();
      const nowMs = now.getTime();
      const [latest, ...rest] = state.events;

      if (latest && isSameEvent(latest, event, nowMs)) {
        return {
          events: [
            {
              ...latest,
              ...event,
              timestamp: now.toISOString(),
              count: latest.count + 1,
            },
            ...rest,
          ],
        };
      }

      return {
        events: [
          {
            ...event,
            id: createEventId(),
            timestamp: now.toISOString(),
            count: 1,
          },
          ...state.events,
        ].slice(0, MAX_DIAGNOSTICS_EVENTS),
      };
    }),
  clearEvents: () => set({ events: [] }),
}));

export type { DiagnosticsCategory, DiagnosticsSeverity };
