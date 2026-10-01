import { create } from "zustand";

export const MAX_KB_PERF_SAMPLES = 50;

export type KBPerfStatus = "success" | "error";
export type KBPerfMetadata = Record<
  string,
  number | string | boolean | null | undefined
>;

export interface KBPerfSample {
  operation: string;
  durationMs: number;
  status: KBPerfStatus;
  metadata?: KBPerfMetadata;
  recordedAt: string;
}

export interface KBPerfSummary {
  operation: string;
  count: number;
  latestDurationMs: number;
  averageDurationMs: number;
  maxDurationMs: number;
  lastStatus: KBPerfStatus;
}

export function summarizeKBPerfSamples(
  samples: KBPerfSample[]
): KBPerfSummary[] {
  const grouped = new Map<string, KBPerfSample[]>();

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

interface KBPerfStoreState {
  samples: KBPerfSample[];
  recordSample: (
    sample: Omit<KBPerfSample, "recordedAt">
  ) => void;
  clearSamples: () => void;
  getOperationSummaries: () => KBPerfSummary[];
}

const roundDuration = (value: number) => Math.round(value);

export const useKBPerfStore = create<KBPerfStoreState>((set, get) => ({
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
      ].slice(0, MAX_KB_PERF_SAMPLES),
    })),
  clearSamples: () => set({ samples: [] }),
  getOperationSummaries: () => summarizeKBPerfSamples(get().samples),
}));

export const recordKBPerfSample = (
  sample: Omit<KBPerfSample, "recordedAt">
) => useKBPerfStore.getState().recordSample(sample);

export const clearKBPerfSamples = () =>
  useKBPerfStore.getState().clearSamples();

const getNow = () => globalThis.performance?.now?.() ?? Date.now();

export async function measureKBPerfAsync<T>(
  operation: string,
  run: () => Promise<T>,
  options?: {
    metadata?: KBPerfMetadata;
    onSuccess?: (result: T) => KBPerfMetadata | undefined;
    onError?: (error: unknown) => KBPerfMetadata | undefined;
  }
) {
  const startedAt = getNow();

  try {
    const result = await run();
    recordKBPerfSample({
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
    recordKBPerfSample({
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
