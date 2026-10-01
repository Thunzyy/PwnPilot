import { create } from "zustand";

interface SeededPrompt {
  text: string;
  source?: string;
}

interface AIComposerState {
  pendingPrompt: SeededPrompt | null;
  seedPrompt: (text: string, source?: string) => void;
  consumePrompt: () => SeededPrompt | null;
  clearPrompt: () => void;
}

export const useAIComposerStore = create<AIComposerState>((set, get) => ({
  pendingPrompt: null,
  seedPrompt: (text, source) =>
    set({
      pendingPrompt: {
        text,
        source,
      },
    }),
  consumePrompt: () => {
    const prompt = get().pendingPrompt;
    set({ pendingPrompt: null });
    return prompt;
  },
  clearPrompt: () => set({ pendingPrompt: null }),
}));
