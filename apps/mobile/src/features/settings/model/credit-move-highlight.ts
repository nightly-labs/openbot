import { create } from "zustand";

export interface CreditMoveHighlight {
  id: number;
  serverId: string;
  personalFrom: number;
  serverFrom: number;
  at: number;
}

interface CreditMoveHighlightState {
  highlight: CreditMoveHighlight | null;
  show: (highlight: Omit<CreditMoveHighlight, "id" | "at">) => void;
  clear: (id: number) => void;
}

let nextHighlightId = 1;

export const useCreditMoveHighlight = create<CreditMoveHighlightState>((set) => ({
  highlight: null,
  show: (highlight) => {
    set({ highlight: { ...highlight, id: nextHighlightId, at: Date.now() } });
    nextHighlightId += 1;
  },
  clear: (id) => set((state) => (state.highlight?.id === id ? { highlight: null } : state)),
}));
