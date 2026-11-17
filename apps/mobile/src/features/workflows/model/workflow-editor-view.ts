import { create } from "zustand";

/** How the editor shows the steps of an outline: as a flow with the two paths side by side, or as lists. */
export type EditorView = "flow" | "list";
export const EDITOR_VIEWS = ["flow", "list"] as const satisfies readonly EditorView[];

/**
 * The view that the person chose last. It stays while the app runs and is not saved: a bundle that an
 * update rolls back to has nothing to read.
 */
export const useWorkflowEditorView = create<{ view: EditorView; setView: (view: EditorView) => void }>((set) => ({
  view: "flow",
  setView: (view) => set({ view }),
}));
