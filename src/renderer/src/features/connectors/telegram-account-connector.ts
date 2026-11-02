import { DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR, type TelegramAccountConnectorStatus } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import {
  type ConnectorAnalyticsAction,
  type ConnectorController,
  createConnectorActions,
  NO_WATCH,
} from "./connector-controller";
import { type TelegramAccountConnectorPort, telegramAccountConnectorPort } from "./telegram-account-connector-port";

/**
 * The Telegram account connection of this computer or of a joined server. Reads the status once and
 * then follows the port's `changed` event: main moves the sign-in on when the phone scans the QR code
 * or Telegram answers a step. The page asks for the method and maybe the api_id and api_hash first, so
 * a card has no one-click connect.
 *
 * Cancel does not wait for another action: a step can wait for Telegram, and Cancel is the way out.
 * The values of the steps go to the port and nowhere else: this controller keeps and logs none.
 */
export function createTelegramAccountConnector(
  port: () => TelegramAccountConnectorPort = telegramAccountConnectorPort,
  /** The joined server whose connection this is, or undefined for this computer's. */
  hostName?: () => string | undefined,
): ConnectorController {
  const [status, setStatus] = createSignal<TelegramAccountConnectorStatus>(DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR);
  /** False until the first status read ends. Until then, the page does not show the default status. */
  const [read, setRead] = createSignal(false);
  /** Why the last status read failed, until a newer status comes. While it is set, the state is not known. */
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const actions = createConnectorActions("connector.telegramAccount.actionFailed", "telegram-account");
  /** Counts the statuses that came, so a failed read does not hide a status that came after it started. */
  let statuses = 0;
  const show = (next: TelegramAccountConnectorStatus) => {
    const before = status().state;
    statuses += 1;
    setStatus(next);
    setStatusError(null);
    // A sign-in ends in main or on the host, with no action of this page, so its end is recorded here.
    if (next.state === "connected" && before !== "connected" && before !== "disconnected" && read())
      desktopAnalytics.track("connector_action", {
        connector: "telegram-account",
        action: "connected",
        result: "succeeded",
      });
  };

  const unsubscribe = port().onChanged((next) => {
    if (!actions.disposed()) show(next);
  });
  const reload = () => {
    const before = statuses;
    void port()
      .status()
      .then((next) => {
        if (!actions.disposed()) show(next);
      })
      .catch((error: unknown) => {
        if (actions.disposed() || before !== statuses) return;
        const { t, errorMessage } = currentText();
        setStatusError(errorMessage(error, t("connector.readFailed")));
      })
      .finally(() => {
        if (!actions.disposed()) setRead(true);
      });
  };
  onSettled(reload);
  onCleanup(unsubscribe);

  const run = (action: () => Promise<TelegramAccountConnectorStatus>, waits = true, track?: ConnectorAnalyticsAction) =>
    actions.run(action, { waits, done: show, ...(track ? { track } : {}) });

  // Opening my.telegram.org does not change the connection, so it does not wait for an action.
  const openApps = () => {
    void port()
      .openApps()
      .catch((error: unknown) => {
        if (actions.disposed()) return;
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("connector.telegramAccount.openAppsFailed")), {
          report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
        });
      });
  };

  return {
    id: "telegram-account",
    ready: read,
    available: () => true,
    busy: actions.busy,
    reload,
    watch: NO_WATCH,
    detail: {
      id: "telegram-account",
      props: {
        get status() {
          return status();
        },
        get busy() {
          return actions.busy();
        },
        get hostName() {
          return hostName?.();
        },
        get statusError() {
          return statusError();
        },
        onRetry: reload,
        onConnect: (input) => run(() => port().connect(input), true, "connect_started"),
        onSubmit: (input) => run(() => port().submit(input)),
        onCancel: () => run(() => port().cancel(), false),
        onDisconnect: () => run(() => port().disconnect(), true, "disconnected"),
        onSetSending: (enabled) => run(() => port().setSending(enabled), true, enabled ? "enabled" : "disabled"),
        onOpenApps: openApps,
      },
    },
  };
}
