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

/** The managers that the shared engine connects and that have no page of their own. */
export type EnginePasswordManagerId = "protonpass";

/** A controller whose page is a page of the shared password manager engine. */
export interface PasswordManagerController extends ConnectorController {
  readonly detail: { id: EnginePasswordManagerId; props: ProtonPassConnectorPanelProps };
}

/**
 * One password manager of this computer or of a joined server, through the shared engine. Reads the
 * list once and then follows the port's `changed` event, because the sign-in ends in the browser.
 * Call it inside a component: the subscription ends with that component.
 *
 * A browser connection that the user starts opens the sign-in page one time, when the host names it.
 * "Open again" in the page opens it again. Cancel does not wait for another action.
 */
export function createPasswordManagerConnector(
  manager: EnginePasswordManagerId,
  port: () => PasswordManagerPort = passwordManagerPort,
  /** The joined server whose connection this is, or undefined for this computer's. */
  hostName: () => string | undefined = () => undefined,
): PasswordManagerController {
  const [status, setStatus] = createSignal<PasswordManagerStatus>(disconnectedPasswordManager(manager));
  /** False until the first list read ends. Until then, the page does not show the default status. */
  const [read, setRead] = createSignal(false);
  /** False when the place's list has no entry for the manager: that host cannot connect it. */
  const [offered, setOffered] = createSignal(true);
  /** Why the last list read failed, until a newer status comes. While it is set, the state is not known. */
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const actions = createConnectorActions("connector.protonPass.actionFailed", manager);
  /** Counts the statuses that came, so a failed read does not hide a status that came after it started. */
  let statuses = 0;
  /** Set by a browser connection that the user started, until its sign-in page opens. */
  let openWhenReady = false;

  /** Not an attempt of its own: a connect that waits for its answer must keep it. */
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
