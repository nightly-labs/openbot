import type { AgentImportPreview, AgentImportResult } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { errorMessage } from "@openbot/ui/error-message";
import {
  type AgentImportPhase,
  type AgentImportSetup,
  AgentImportView,
} from "@openbot/ui/features/import/AgentImportView";
import { createSignal, createStore, onSettled } from "solid-js";

/** The way into Grok Bot this viewer chose last, so a user who set up the skill starts there. */
const SETUP_STORAGE_KEY = "openbot.agent-import.setup";

function readSetup(): AgentImportSetup {
  try {
    return window.localStorage.getItem(SETUP_STORAGE_KEY) === "skill" ? "skill" : "agent";
  } catch {
    return "agent";
  }
}

export interface ServerImportOptions {
  onOpenAgent: (agentId: string) => void;
  /** Closes the settings the panel is in. */
  onClose: () => void;
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

  const [setup, setSetup] = createSignal(readSetup());
  const changeSetup = (next: AgentImportSetup) => {
    setSetup(next);
    try {
      window.localStorage.setItem(SETUP_STORAGE_KEY, next);
    } catch {
      // The choice is a convenience. Without storage, the panel opens on the default again.
    }
  };

  // Read once: the skill ships with the app and does not change while it runs.
  const [exportSkill, setExportSkill] = createSignal<string | null>(null);
  onSettled(() => {
    void window.openbot.agentImport
      .readSkill()
      .then(setExportSkill)
      .catch(() => setExportSkill(null));
  });

  const saveSkill = async () => {
    try {
      await window.openbot.agentImport.saveSkill();
    } catch (error) {
      toast.error("The skill was not saved", { description: errorMessage(error, "Try again.") });
    }
  };

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

  const apply = async (keys: string[], channelKeys: string[]) => {
    const preview = state.preview;
    if (!preview) return;
    setState((draft) => {
      draft.phase = "importing";
      draft.error = null;
    });
    try {
      const result = await window.openbot.agentImport.apply({ token: preview.token, keys, channelKeys });
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
      setup={setup()}
      exportSkill={exportSkill()}
      onSetupChange={changeSetup}
      onOpenExportAgent={() => void window.openbot.openExternal("grok-bot-export")}
      onSaveExportSkill={() => void saveSkill()}
      onChoose={() => void choose()}
      onImport={(keys, channelKeys) => void apply(keys, channelKeys)}
      onCancel={reset}
      onDone={() => {
        reset();
        props.onClose();
      }}
      onOpenAgent={props.onOpenAgent}
    />
  );
}
