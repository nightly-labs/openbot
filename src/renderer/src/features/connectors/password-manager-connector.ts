import {
  disconnectedPasswordManager,
  type PasswordManagerConnectMethod,
  type PasswordManagerStatus,
} from "@openbot/contracts/ipc";
import type { ProtonPassConnectorPanelProps } from "@openbot/ui/features/settings/ProtonPassConnectorPanel";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled } from "solid-js";
import {
  type ConnectorAnalyticsAction,
  type ConnectorController,
  createConnectorActions,
  NO_WATCH,
} from "./connector-controller";
import { type PasswordManagerPort, passwordManagerPort } from "./password-manager-port";

export type EnginePasswordManagerId = "protonpass";

export interface PasswordManagerController extends ConnectorController {
  readonly detail: { id: EnginePasswordManagerId; props: ProtonPassConnectorPanelProps };
}

export function createPasswordManagerConnector(
  manager: EnginePasswordManagerId,
  port: () => PasswordManagerPort = passwordManagerPort,
  hostName: () => string | undefined = () => undefined,
): PasswordManagerController {
  const [status, setStatus] = createSignal<PasswordManagerStatus>(disconnectedPasswordManager(manager));
  const [read, setRead] = createSignal(false);
  const [offered, setOffered] = createSignal(true);
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const actions = createConnectorActions("connector.protonPass.actionFailed", manager);
  let statuses = 0;
  let openWhenReady = false;

  const openSignIn = () => {
    void port()
      .openSignIn(manager)
      .catch((error: unknown) => {
        if (!actions.disposed()) actions.report(error);
      });
  };
  const show = (next: PasswordManagerStatus) => {
    if (next.manager !== manager) return;
    statuses += 1;
    setStatus(next);
    setStatusError(null);
    if (next.state !== "signing-in") openWhenReady = false;
    else if (openWhenReady && next.step === "browser" && next.signInUrl) {
      openWhenReady = false;
      openSignIn();
    }
  };

  const unsubscribe = port().onChanged((next) => {
    if (!actions.disposed()) show(next);
  });
  const reload = () => {
    const before = statuses;
    void port()
      .list()
      .then((list) => {
        if (actions.disposed()) return;
        const next = list.find((entry) => entry.manager === manager);
        setOffered(next !== undefined);
        show(next ?? disconnectedPasswordManager(manager));
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

  const connectWith = (method: PasswordManagerConnectMethod, track?: ConnectorAnalyticsAction) => {
    openWhenReady = method.kind === "browser";
    actions.run(() => port().connect({ manager, method }), {
      done: show,
      ...(track ? { track } : {}),
    });
  };
  const connect = () => connectWith({ kind: "browser" }, "connect_started");

  return {
    id: manager,
    ready: read,
    available: offered,
    busy: actions.busy,
    connect,
    reload,
    watch: NO_WATCH,
    detail: {
      id: manager,
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
          return hostName();
        },
        onRetry: reload,
        onConnect: connect,
        onConnectWithKey: (key) => connectWith({ kind: "key", key }, "connected"),
        onSubmitExtraPassword: (password) => connectWith({ kind: "extra-password", password }),
        onCancel: () => {
          openWhenReady = false;
          actions.run(() => port().cancel(manager), { waits: false, done: show });
        },
        onDisconnect: () => actions.run(() => port().disconnect(manager), { done: show, track: "disconnected" }),
        onOpenSignIn: openSignIn,
      },
    },
  };
}
