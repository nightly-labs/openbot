import { create } from "zustand";

export interface CreditMoveHighlight {
  id: number;
  serverId: string;
  personalFrom: number;
  serverFrom: number;
}

interface CreditMoveHighlightState {
  highlight: CreditMoveHighlight | null;
  show: (highlight: Omit<CreditMoveHighlight, "id">) => void;
  clear: (id: number) => void;
}

let nextHighlightId = 1;

export const useCreditMoveHighlight = create<CreditMoveHighlightState>((set) => ({
  highlight: null,
  show: (highlight) => {
    set({ highlight: { ...highlight, id: nextHighlightId } });
    nextHighlightId += 1;
  },
  clear: (id) => set((state) => (state.highlight?.id === id ? { highlight: null } : state)),
}));
