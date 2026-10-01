import { create } from "zustand";

export const MAX_TIMELINE_PERF_SAMPLES = 50;

export type TimelinePerfStatus = "success" | "error";
export type TimelinePerfMetadata = Record<
  string,
  number | string | boolean | null | undefined
>;

export interface TimelinePerfSample {
  operation: string;
  durationMs: number;
  status: TimelinePerfStatus;
  metadata?: TimelinePerfMetadata;
  recordedAt: string;
}

export interface TimelinePerfSummary {
  operation: string;
  count: number;
  latestDurationMs: number;
  averageDurationMs: number;
  maxDurationMs: number;
  lastStatus: TimelinePerfStatus;
}

const roundDuration = (value: number) => Math.round(value);

export function summarizeTimelinePerfSamples(
  samples: TimelinePerfSample[]
): TimelinePerfSummary[] {
  const grouped = new Map<string, TimelinePerfSample[]>();

  for (const sample of samples) {
    const bucket = grouped.get(sample.operation);
    if (bucket) {
      bucket.push(sample);
    } else {
      grouped.set(sample.operation, [sample]);
    }
  }

  return [...grouped.entries()]
    .map(([operation, groupedSamples]) => {
      const durations = groupedSamples.map((sample) => sample.durationMs);
      const totalDuration = durations.reduce((sum, value) => sum + value, 0);
      const latest = groupedSamples[0];

      return {
        operation,
        count: groupedSamples.length,
        latestDurationMs: latest.durationMs,
        averageDurationMs: roundDuration(totalDuration / groupedSamples.length),
        maxDurationMs: Math.max(...durations),
        lastStatus: latest.status,
      };
    })
    .sort((left, right) => left.operation.localeCompare(right.operation));
}

interface TimelinePerfStoreState {
  samples: TimelinePerfSample[];
  recordSample: (sample: Omit<TimelinePerfSample, "recordedAt">) => void;
  clearSamples: () => void;
  getOperationSummaries: () => TimelinePerfSummary[];
}

export const useTimelinePerfStore = create<TimelinePerfStoreState>((set, get) => ({
  samples: [],
  recordSample: (sample) =>
    set((state) => ({
      samples: [
        {
          ...sample,
          durationMs: roundDuration(sample.durationMs),
          recordedAt: new Date().toISOString(),
        },
        ...state.samples,
      ].slice(0, MAX_TIMELINE_PERF_SAMPLES),
    })),
  clearSamples: () => set({ samples: [] }),
  getOperationSummaries: () => summarizeTimelinePerfSamples(get().samples),
}));

export const recordTimelinePerfSample = (
  sample: Omit<TimelinePerfSample, "recordedAt">
) => useTimelinePerfStore.getState().recordSample(sample);

export const clearTimelinePerfSamples = () =>
  useTimelinePerfStore.getState().clearSamples();

const getNow = () => globalThis.performance?.now?.() ?? Date.now();

export async function measureTimelinePerfAsync<T>(
  operation: string,
  run: () => Promise<T>,
  options?: {
    metadata?: TimelinePerfMetadata;
    onSuccess?: (result: T) => TimelinePerfMetadata | undefined;
    onError?: (error: unknown) => TimelinePerfMetadata | undefined;
  }
) {
  const startedAt = getNow();

  try {
    const result = await run();
    recordTimelinePerfSample({
      operation,
      durationMs: getNow() - startedAt,
      status: "success",
      metadata: {
        ...options?.metadata,
        ...options?.onSuccess?.(result),
      },
    });
    return result;
  } catch (error) {
    recordTimelinePerfSample({
      operation,
      durationMs: getNow() - startedAt,
      status: "error",
      metadata: {
        ...options?.metadata,
        ...options?.onError?.(error),
      },
    });
    throw error;
  }
}
