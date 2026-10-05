import { DISCONNECTED_ONEPASSWORD_CONNECTOR, type OnePasswordConnectorStatus } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { OnePasswordConnectorPanelProps } from "@openbot/ui/features/settings/OnePasswordConnectorPanel";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { type OnePasswordConnectorPort, onePasswordConnectorPort } from "./onepassword-connector-port";

export interface OnePasswordConnectorController {
  status: () => OnePasswordConnectorStatus;
  busy: () => boolean;
  /**
   * Checks the setup now and each time this window gets the focus back, until the returned stop is
   * called: the user turns on the CLI integration in the 1Password app, outside this window.
   */
  watchSetup: () => () => void;
  checkSetup: () => void;
  installCli: () => void;
  openApp: () => void;
  connect: (accountId: string | null) => void;
  connectWithToken: (token: string) => void;
  cancel: () => void;
  disconnect: () => void;
}

/**
 * The 1Password connection of this computer, for the page that shows it. Reads the status once and
 * then follows main's `changed` event: the CLI waits for an approval in the 1Password app, and the
 * login count arrives after the vault is read. Call it inside a component: the subscription ends
 * with that component.
 *
 * Cancel does not wait for another action: Connect waits for the CLI, and Cancel is the way out.
 */
export function createOnePasswordConnector(
  port: () => OnePasswordConnectorPort = onePasswordConnectorPort,
): OnePasswordConnectorController {
  const [status, setStatus] = createSignal<OnePasswordConnectorStatus>(DISCONNECTED_ONEPASSWORD_CONNECTOR);
  const [busy, setBusy] = createSignal(false);
  let disposed = false;

  const unsubscribe = port().onChanged((next) => {
    if (!disposed) setStatus(next);
  });
  onSettled(() => {
    void port()
      .status()
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch(() => undefined);
  });
  onCleanup(() => {
    disposed = true;
    unsubscribe();
  });

  /**
   * Each action is one attempt. Cancel starts a new one and frees the buttons at once: main can still
   * be finishing the cancelled read, and its late answer must not replace the newer status or lock.
   */
  let attempt = 0;
  const run = (action: () => Promise<OnePasswordConnectorStatus>, waits = true) => {
    if (waits && busy()) return;
    const current = ++attempt;
    setBusy(waits);
    void action()
      .then((next) => {
        if (!disposed && current === attempt) setStatus(next);
      })
      .catch((error: unknown) => {
        if (current !== attempt) return;
        const { t, errorMessage } = currentText();
        toast.error(t("connector.onePassword.actionFailed"), {
          description: errorMessage(error, t("connector.onePassword.actionFailed")),
        });
      })
      .finally(() => {
        if (!disposed && current === attempt) setBusy(false);
      });
  };

  // A failed check keeps the last status. The next focus or action checks again.
  const checkSetup = () => {
    void port()
      .checkSetup()
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch(() => undefined);
  };

  return {
    status,
    busy,
    watchSetup: () => {
      checkSetup();
      window.addEventListener("focus", checkSetup);
      return () => window.removeEventListener("focus", checkSetup);
    },
    checkSetup,
    installCli: () => run(() => port().installCli()),
    openApp: () => {
      void port()
        .openApp()
        .catch(() => undefined);
    },
    connect: (accountId) => run(() => port().connect({ accountId })),
    connectWithToken: (token) => run(() => port().connectWithToken(token)),
    cancel: () => run(() => port().cancel(), false),
    disconnect: () => run(() => port().disconnect()),
  };
}

/** The panel props of the controller, read live. */
export function onePasswordPanelProps(controller: OnePasswordConnectorController): OnePasswordConnectorPanelProps {
  return {
    get status() {
      return controller.status();
    },
    get busy() {
      return controller.busy();
    },
    onWatchSetup: controller.watchSetup,
    onCheckSetup: controller.checkSetup,
    onInstallCli: controller.installCli,
    onOpenApp: controller.openApp,
    onConnect: controller.connect,
    onConnectWithToken: controller.connectWithToken,
    onCancel: controller.cancel,
    onDisconnect: controller.disconnect,
  };
}
