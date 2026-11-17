import { create } from "zustand";

/** How the workflow page, the editor and a run show the steps: as a flow from left to right, or as a list. */
export type EditorView = "flow" | "list";

/**
 * The view that the person chose last. It stays while the app runs and is not saved: a bundle that an
 * update rolls back to has nothing to read.
 */
export const useWorkflowEditorView = create<{ view: EditorView; setView: (view: EditorView) => void }>((set) => ({
  view: "flow",
  setView: (view) => set({ view }),
}));
