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

/**
 * The 1Password connection of this computer or of a joined server. Reads the status once and then
 * follows the port's `changed` event: the CLI waits for an approval in the 1Password app, and the
 * login count arrives after the vault is read. Call it inside a component: the subscription ends with
 * that component.
 *
 * Cancel does not wait for another action: Connect waits for the CLI, and Cancel is the way out.
 * The page asks for the setup first, so a card has no one-click connect. A joined server connects
 * with a token only; its check reads the host's status, and the host reads its logins again.
 */
export function createOnePasswordConnector(
  port: () => OnePasswordConnectorPort = onePasswordConnectorPort,
  /** The joined server whose connection this is, or undefined for this computer's. */
  hostName?: () => string | undefined,
): ConnectorController {
  const [status, setStatus] = createSignal<OnePasswordConnectorStatus>(DISCONNECTED_ONEPASSWORD_CONNECTOR);
  /** False until the first status read ends. Until then, the page does not show the default status. */
  const [read, setRead] = createSignal(false);
  /** Why the last status read failed, until a newer status comes. While it is set, the state is not known. */
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const actions = createConnectorActions("connector.onePassword.actionFailed", "onepassword");
  /** Counts the statuses that came, so a failed read does not hide a status that came after it started. */
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

  // A failed check keeps the last status. The next focus or action checks again.
  const checkSetup = () => {
    void port()
      .checkSetup()
      .then((next) => {
        if (!actions.disposed()) show(next);
      })
      .catch(() => undefined);
  };

  // Opening the app does not change the connection, so it does not wait for an action or lock a button.
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
        // The user turns on the CLI integration or adds logins in the 1Password app, outside this window.
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
