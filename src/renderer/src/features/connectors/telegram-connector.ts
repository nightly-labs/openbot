import type { TelegramOverview } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type {
  TelegramChatPlace,
  TelegramOrchestratorChoice,
  TelegramOrchestratorModels,
} from "@openbot/ui/features/settings/TelegramIntegrationPanel";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { type TelegramConnectorPort, telegramConnectorPort } from "./telegram-connector-port";

/** How often the Telegram page reads the chats while it shows: a chat links in Telegram. */
const POLL_MS = 3_000;

export interface TelegramConnectorController {
  /** Null until the first read. */
  overview: () => TelegramOverview | null;
  busy: () => boolean;
  /** Reads the chats now and then every few seconds. Call the result to stop. */
  watch: () => () => void;
  connectChat: (place: TelegramChatPlace) => void;
  disconnectChat: (workspaceId: string) => void;
  reconnect: (workspaceId: string) => void;
  setEnabled: (workspaceId: string, enabled: boolean) => void;
  /** The catalog for the orchestrator's model picker, or undefined to start on a new agent's default. */
  models: () => TelegramOrchestratorModels | undefined;
  addOrchestrator: (choice: TelegramOrchestratorChoice | null) => void;
}

/**
 * The Telegram chats of this computer, for Server settings > Connectors. Main sends no event for a
 * chat, and a chat links in Telegram, so a page that shows the state calls `watch`.
 */
export function createTelegramConnector(
  port: () => TelegramConnectorPort = telegramConnectorPort,
  models: () => TelegramOrchestratorModels | undefined = () => undefined,
  /** Called with the sidebar section that main put the new orchestrator in. */
  onOrchestratorSection: (sectionId: string) => void = () => undefined,
): TelegramConnectorController {
  const [overview, setOverview] = createSignal<TelegramOverview | null>(null);
  const [busy, setBusy] = createSignal(false);
  let disposed = false;
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let reads = 0;

  // A failed read keeps the last overview. The next poll or action reads again.
  const reload = () => {
    const read = ++reads;
    void port()
      .messaging.getTelegramOverview()
      .then((next) => {
        if (!disposed && read === reads) setOverview(next);
      })
      .catch(() => undefined);
  };
  onCleanup(() => {
    disposed = true;
  });

  const run = (action: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    void action()
      .catch((error: unknown) => {
        const { t, errorMessage } = currentText();
        actionToast.error(t("connector.telegram.actionFailed"), {
          ...{
            description: errorMessage(error, t("connector.telegram.actionFailed")),
          },
          report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
        });
      })
      .finally(() => {
        if (disposed) return;
        setBusy(false);
        reload();
      });
  };
  const messaging = () => port().messaging;

  return {
    overview,
    busy,
    watch: () => {
      reload();
      const timer = setInterval(reload, POLL_MS);
      return () => clearInterval(timer);
    },
    connectChat: (place) => run(() => messaging().connectTelegramChat({ place })),
    disconnectChat: (workspaceId) => run(() => messaging().disconnectTelegramChat({ workspaceId })),
    reconnect: (workspaceId) => run(() => messaging().reconnectTelegramChat({ workspaceId })),
    setEnabled: (workspaceId, enabled) => run(() => messaging().setTelegramEnabled({ workspaceId, enabled })),
    models,
    addOrchestrator: (choice) =>
      run(async () => {
        const { sectionId } = await messaging().addTelegramOrchestrator({ ...(choice ?? {}) });
        if (sectionId) onOrchestratorSection(sectionId);
      }),
  };
}
