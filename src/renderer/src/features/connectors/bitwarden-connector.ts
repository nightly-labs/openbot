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

export function createBitwardenConnector(
  port: () => BitwardenConnectorPort = bitwardenConnectorPort,
  hostName?: () => string | undefined,
): ConnectorController {
  const [status, setStatus] = createSignal<BitwardenConnectorStatus>(DISCONNECTED_BITWARDEN_CONNECTOR);
  const [read, setRead] = createSignal(false);
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const actions = createConnectorActions("connector.bitwarden.actionFailed", "bitwarden");
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
