import { create } from "zustand";

export type EditorView = "flow" | "list";

export const useWorkflowEditorView = create<{ view: EditorView; setView: (view: EditorView) => void }>((set) => ({
  view: "flow",
  setView: (view) => set({ view }),
}));
