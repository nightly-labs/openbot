import type { TelegramOverview } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { type TelegramConnectorPort, telegramConnectorPort } from "./telegram-connector-port";

const POLL_MS = 3_000;

export interface TelegramConnectorController {
  overview: () => TelegramOverview | null;
  busy: () => boolean;
  watch: () => () => void;
  connectTelegram: (botToken: string) => void;
  disconnectTelegram: (workspaceId: string) => void;
  reconnect: (workspaceId: string) => void;
  setEnabled: (workspaceId: string, enabled: boolean) => void;
  setAgent: (workspaceId: string, agentId: string | null) => void;
}

export function createTelegramConnector(
  port: () => TelegramConnectorPort = telegramConnectorPort,
): TelegramConnectorController {
  const [overview, setOverview] = createSignal<TelegramOverview | null>(null);
  const [busy, setBusy] = createSignal(false);
  let disposed = false;
  let reads = 0;

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
          description: errorMessage(error, t("connector.telegram.actionFailed")),
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
    connectTelegram: (botToken: string) => run(() => messaging().connectTelegram({ botToken })),
    disconnectTelegram: (workspaceId: string) => run(() => messaging().disconnectTelegram({ workspaceId })),
    reconnect: (workspaceId: string) => run(() => messaging().reconnectTelegram({ workspaceId })),
    setEnabled: (workspaceId: string, enabled: boolean) =>
      run(() => messaging().setTelegramEnabled({ workspaceId, enabled })),
    setAgent: (workspaceId: string, agentId: string | null) =>
      run(() => messaging().setTelegramAgent({ workspaceId, agentId })),
  };
}
