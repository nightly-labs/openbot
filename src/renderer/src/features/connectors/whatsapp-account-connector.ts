import { DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR, type WhatsAppAccountConnectorStatus } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import {
  type ConnectorAnalyticsAction,
  type ConnectorController,
  createConnectorActions,
  NO_WATCH,
} from "./connector-controller";
import { type WhatsAppAccountConnectorPort, whatsappAccountConnectorPort } from "./whatsapp-account-connector-port";

/**
 * The WhatsApp account connection of this computer or of a joined server. Reads the status once and
 * then follows the port's `changed` event: main moves the link on when the phone scans the QR code or
 * the user types the code on the phone. The page asks for the method first, so a card has no one-click
 * connect.
 *
 * Cancel does not wait for another action: a step can wait for WhatsApp, and Cancel is the way out.
 * The phone number goes to the port and nowhere else: this controller keeps and logs none.
 */
export function createWhatsAppAccountConnector(
  port: () => WhatsAppAccountConnectorPort = whatsappAccountConnectorPort,
  /** The joined server whose connection this is, or undefined for this computer's. */
  hostName?: () => string | undefined,
): ConnectorController {
  const [status, setStatus] = createSignal<WhatsAppAccountConnectorStatus>(DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR);
  /** False until the first status read ends. Until then, the page does not show the default status. */
  const [read, setRead] = createSignal(false);
  /** Why the last status read failed, until a newer status comes. While it is set, the state is not known. */
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const actions = createConnectorActions("connector.whatsappAccount.actionFailed", "whatsapp-account");
  /** Counts the statuses that came, so a failed read does not hide a status that came after it started. */
  let statuses = 0;
  const show = (next: WhatsAppAccountConnectorStatus) => {
    const before = status().state;
    statuses += 1;
    setStatus(next);
    setStatusError(null);
    // A link ends in main or on the host, with no action of this page, so its end is recorded here.
    if (next.state === "connected" && before !== "connected" && before !== "disconnected" && read())
      desktopAnalytics.track("connector_action", {
        connector: "whatsapp-account",
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

  const run = (action: () => Promise<WhatsAppAccountConnectorStatus>, waits = true, track?: ConnectorAnalyticsAction) =>
    actions.run(action, { waits, done: show, ...(track ? { track } : {}) });

  return {
    id: "whatsapp-account",
    ready: read,
    available: () => true,
    busy: actions.busy,
    reload,
    watch: NO_WATCH,
    detail: {
      id: "whatsapp-account",
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
      },
    },
  };
}
