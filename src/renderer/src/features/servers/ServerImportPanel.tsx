import type { AgentImportPreview, AgentImportResult } from "@openbot/contracts/ipc";
import { errorMessage } from "@openbot/ui/error-message";
import { type AgentImportPhase, AgentImportView } from "@openbot/ui/features/import/AgentImportView";
import { createStore, onSettled } from "solid-js";

export interface ServerImportOptions {
  onOpenAgent: (agentId: string) => void;
}

interface ImportState {
  phase: AgentImportPhase;
  error: string | null;
  preview: AgentImportPreview | null;
  result: AgentImportResult | null;
}

/**
 * Server settings > Import, for the local server only. Main opens the file dialog and keeps the
 * export under a token, so the panel holds the preview and never a path. A preview left open when
 * the panel closes is released.
 */
export function ServerImportPanel(props: ServerImportOptions) {
  const [state, setState] = createStore<ImportState>({ phase: "idle", error: null, preview: null, result: null });
  const show = (next: ImportState) =>
    setState((draft) => {
      Object.assign(draft, next);
    });

  const release = () => {
    const token = state.preview?.token;
    if (token) void window.openbot.agentImport.discard(token).catch(() => undefined);
  };
  onSettled(() => release);

  const choose = async () => {
    const open = state.preview;
    setState((draft) => {
      draft.phase = "reading";
      draft.error = null;
    });
    try {
      // Null when the user cancels the dialog. Main keeps the export that was open until then.
      const preview = (await window.openbot.agentImport.choose()) ?? open;
      show({ phase: preview ? "review" : "idle", error: null, preview, result: null });
    } catch (error) {
      // Main released the open export when it started to read the new one.
      show({ phase: "idle", error: errorMessage(error, "The export could not be read."), preview: null, result: null });
    }
  };

  const apply = async (keys: string[]) => {
    const preview = state.preview;
    if (!preview) return;
    setState((draft) => {
      draft.phase = "importing";
      draft.error = null;
    });
    try {
      const result = await window.openbot.agentImport.apply({ token: preview.token, keys });
      show({ phase: "done", error: null, preview: null, result });
    } catch (error) {
      // The token is spent either way, so the user chooses the export again.
      show({ phase: "idle", error: errorMessage(error, "The import did not finish."), preview: null, result: null });
    }
  };

  const reset = () => {
    release();
    show({ phase: "idle", error: null, preview: null, result: null });
  };

  return (
    <AgentImportView
      phase={state.phase}
      error={state.error}
      preview={state.preview}
      result={state.result}
      onOpenExportAgent={() => void window.openbot.openExternal("grok-bot-export")}
      onChoose={() => void choose()}
      onImport={(keys) => void apply(keys)}
      onCancel={reset}
      onOpenAgent={props.onOpenAgent}
    />
  );
}
