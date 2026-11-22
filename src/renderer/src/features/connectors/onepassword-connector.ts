import { DISCONNECTED_ONEPASSWORD_CONNECTOR, type OnePasswordConnectorStatus } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { actionToast } from "../../action-toast";
import {
  type ConnectorAnalyticsAction,
  type ConnectorController,
  createConnectorActions,
  NO_WATCH,
} from "./connector-controller";
import { type OnePasswordConnectorPort, onePasswordConnectorPort } from "./onepassword-connector-port";

export function createOnePasswordConnector(
  port: () => OnePasswordConnectorPort = onePasswordConnectorPort,
  hostName?: () => string | undefined,
): ConnectorController {
  const [status, setStatus] = createSignal<OnePasswordConnectorStatus>(DISCONNECTED_ONEPASSWORD_CONNECTOR);
  const [read, setRead] = createSignal(false);
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const actions = createConnectorActions("connector.onePassword.actionFailed", "onepassword");
  let statuses = 0;
  const show = (next: OnePasswordConnectorStatus) => {
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

  const run = (action: () => Promise<OnePasswordConnectorStatus>, waits = true, track?: ConnectorAnalyticsAction) =>
    actions.run(action, { waits, done: show, ...(track ? { track } : {}) });

  const checkSetup = () => {
    void port()
      .checkSetup()
      .then((next) => {
        if (!actions.disposed()) show(next);
      })
      .catch(() => undefined);
  };

  const openApp = () => {
    void port()
      .openApp()
      .catch((error: unknown) => {
        if (actions.disposed()) return;
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("connector.onePassword.openAppFailed")), {
          report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
        });
      });
  };

  return {
    id: "onepassword",
    ready: read,
    available: () => true,
    busy: actions.busy,
    reload,
    watch: NO_WATCH,
    detail: {
      id: "onepassword",
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
        onWatchSetup: () => {
          checkSetup();
          window.addEventListener("focus", checkSetup);
          return () => window.removeEventListener("focus", checkSetup);
        },
        onCheckSetup: checkSetup,
        onInstallCli: () => run(() => port().installCli()),
        onOpenApp: openApp,
        onConnect: (accountId) => run(() => port().connect({ accountId }), true, "connect_started"),
        onConnectWithToken: (token) => run(() => port().connectWithToken(token), true, "connected"),
        onCancel: () => run(() => port().cancel(), false),
        onDisconnect: () => run(() => port().disconnect(), true, "disconnected"),
      },
    },
  };
}
