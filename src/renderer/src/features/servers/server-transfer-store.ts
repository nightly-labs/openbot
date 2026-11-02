import type {
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSummary,
  OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type {
  InstanceExportOptions,
  InstanceExportPhase,
  InstanceImportPhase,
  InstanceTransferScreen,
} from "@openbot/ui/features/transfer/InstanceTransferView";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { desktopAnalytics } from "../../analytics";

/** The transfer calls of one server. Main routes them to this computer or to a joined host. */
export type ServerTransferCalls = OpenBotDesktopApi["instanceTransfer"];

interface ServerTransferState {
  screen: InstanceTransferScreen;
  summary: InstanceTransferSummary | null;
  exportPhase: InstanceExportPhase;
  exportFileName: string | null;
  exportWarnings: string[];
  exportError: string | null;
  importPhase: InstanceImportPhase;
  preview: InstanceTransferPreview | null;
  result: InstanceTransferResult | null;
  importError: string | null;
}

const INITIAL: ServerTransferState = {
  screen: "home",
  summary: null,
  exportPhase: "options",
  exportFileName: null,
  exportWarnings: [],
  exportError: null,
  importPhase: "idle",
  preview: null,
  result: null,
  importError: null,
};

/** The Transfer section's view of one export and one import of one server. */
export function createServerTransferStore(serverId: string, calls: ServerTransferCalls) {
  const [state, setState] = createStore<ServerTransferState>({ ...INITIAL });

  // The agents are read again each time the export screen opens.
  createEffect(
    () => state.screen === "export" && state.exportPhase === "options",
    (load) => {
      if (!load) return;
      void calls
        .summary(serverId)
        .then((summary) =>
          setState((draft) => {
            draft.summary = summary;
          }),
        )
        .catch((error: unknown) =>
          setState((draft) => {
            draft.exportError = message(error, "settings.transfer.export.failed");
          }),
        );
    },
  );

  function setScreen(screen: InstanceTransferScreen): void {
    setState((draft) => {
      draft.screen = screen;
      draft.exportError = null;
      draft.importError = null;
    });
  }

  function exportFile(options: InstanceExportOptions): void {
    setState((draft) => {
      draft.exportPhase = "exporting";
      draft.exportError = null;
    });
    void calls
      .export(options, serverId)
      .then((result) => {
        // A closed save dialog saves nothing.
        desktopAnalytics.track("server_transfer_action", {
          action: "export",
          result: result.saved ? "succeeded" : "cancelled",
        });
        setState((draft) => {
          draft.exportPhase = result.saved ? "saved" : "options";
          draft.exportFileName = result.fileName;
          draft.exportWarnings = result.warnings;
        });
      })
      .catch((error: unknown) => {
        desktopAnalytics.track("server_transfer_action", {
          action: "export",
          result: "failed",
          failure_code: "export_failed",
        });
        setState((draft) => {
          draft.exportPhase = "options";
          draft.exportError = message(error, "settings.transfer.export.failed");
        });
      });
  }

  function showExport(): void {
    void calls.showExport().catch(report);
  }

  function exportAgain(): void {
    setState((draft) => {
      draft.exportPhase = "options";
      draft.exportFileName = null;
      draft.exportWarnings = [];
    });
  }

  function choose(): void {
    setState((draft) => {
      draft.importPhase = "reading";
      draft.importError = null;
    });
    void calls
      .choose(serverId)
      .then((preview) =>
        setState((draft) => {
          // A closed dialog keeps the file that was open before.
          if (preview) draft.preview = preview;
          draft.importPhase = draft.preview ? "review" : "idle";
        }),
      )
      .catch((error: unknown) =>
        setState((draft) => {
          draft.importPhase = draft.preview ? "review" : "idle";
          draft.importError = message(error, "settings.transfer.import.openFailed");
        }),
      );
  }

  function importFile(keys: string[], includeSettings: boolean): void {
    const token = state.preview?.token;
    if (!token) return;
    setState((draft) => {
      draft.importPhase = "importing";
      draft.importError = null;
    });
    void calls
      .apply({ token, keys, includeSettings }, serverId)
      .then((result) => {
        desktopAnalytics.track("server_transfer_action", { action: "import", result: "succeeded" });
        setState((draft) => {
          draft.importPhase = "done";
          draft.preview = null;
          draft.result = result;
        });
      })
      .catch((error: unknown) => {
        desktopAnalytics.track("server_transfer_action", {
          action: "import",
          result: "failed",
          failure_code: "import_failed",
        });
        setState((draft) => {
          // The token is spent once main starts, so the file must be chosen again.
          draft.importPhase = "idle";
          draft.preview = null;
          draft.importError = message(error, "settings.transfer.import.failed");
        });
      });
  }

  function cancelImport(): void {
    const token = state.preview?.token;
    if (token) void calls.discard(token, serverId).catch(report);
    setState((draft) => {
      draft.importPhase = "idle";
      draft.preview = null;
      draft.importError = null;
    });
  }

  function importDone(): void {
    setState((draft) => {
      draft.importPhase = "idle";
      draft.result = null;
      draft.screen = "home";
    });
  }

  return { state, setScreen, exportFile, showExport, exportAgain, choose, importFile, cancelImport, importDone };
}

function message(
  error: unknown,
  fallback:
    | "settings.transfer.export.failed"
    | "settings.transfer.import.openFailed"
    | "settings.transfer.import.failed",
): string {
  const { t, errorMessage } = currentText();
  return errorMessage(error, t(fallback));
}

function report(error: unknown): void {
  const { t, errorMessage } = currentText();
  toast.error(errorMessage(error, t("settings.transfer.import.failed")), {
    report: { operation: "settings", source: "system", cause_code: "unknown" },
  });
}
