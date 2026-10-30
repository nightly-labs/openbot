import { type BitwardenConnectorStatus, DISCONNECTED_BITWARDEN_CONNECTOR } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { type BitwardenConnectorPort, bitwardenConnectorPort } from "./bitwarden-connector-port";
import {
  type ConnectorAnalyticsAction,
  type ConnectorController,
  createConnectorActions,
  NO_WATCH,
} from "./connector-controller";

/**
 * The Bitwarden connection of this computer or of a joined server. Reads the status once and then
 * follows the port's `changed` event. The page asks for a session key, or on a joined server for an
 * API key and the master password, so a card has no one-click connect.
 */
export function createBitwardenConnector(
  port: () => BitwardenConnectorPort = bitwardenConnectorPort,
  /** The joined server whose connection this is, or undefined for this computer's. */
  hostName?: () => string | undefined,
): ConnectorController {
  const [status, setStatus] = createSignal<BitwardenConnectorStatus>(DISCONNECTED_BITWARDEN_CONNECTOR);
  /** False until the first status read ends. Until then, the page does not show the default status. */
  const [read, setRead] = createSignal(false);
  /** Why the last status read failed, until a newer status comes. While it is set, the state is not known. */
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const actions = createConnectorActions("connector.bitwarden.actionFailed", "bitwarden");
  /** Counts the statuses that came, so a failed read does not hide a status that came after it started. */
  let statuses = 0;
  const show = (next: BitwardenConnectorStatus) => {
    statuses += 1;
    setStatus(next);
    setStatusError(null);
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

  const run = (action: () => Promise<BitwardenConnectorStatus>, track: ConnectorAnalyticsAction) =>
    actions.run(action, { done: show, track });

  return {
    id: "bitwarden",
    ready: read,
    available: () => true,
    busy: actions.busy,
    reload,
    watch: NO_WATCH,
    detail: {
      id: "bitwarden",
      props: {
        get status() {
          return status();
        },
        get busy() {
          return actions.busy();
        },
        get statusError() {
          return statusError();
        },
        get hostName() {
          return hostName?.();
        },
        onRetry: reload,
        onConnect: (key) => run(() => port().connect(key), "connected"),
        onConnectHost: (input) => run(() => port().connectHost(input), "connected"),
        onDisconnect: () => run(() => port().disconnect(), "disconnected"),
      },
    },
  };
}
