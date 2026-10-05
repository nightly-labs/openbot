import {
  DISCONNECTED_ONEPASSWORD_CONNECTOR,
  type OnePasswordConnectorDesktopApi,
  type OnePasswordConnectorStatus,
  type OnePasswordSetup,
} from "@openbot/contracts/ipc";

/** How long the mock CLI takes to download, and to create the vault and the service account. */
const MOCK_INSTALL_MS = 1_500;
const MOCK_CONNECT_MS = 1_500;

const READY: OnePasswordSetup = { cli: "ready", cliVersion: "2.39.0", canInstall: true, appIntegration: true };

const CONNECTED: OnePasswordConnectorStatus = {
  ...DISCONNECTED_ONEPASSWORD_CONNECTOR,
  state: "connected",
  setup: READY,
  vaultNames: ["Shared with OpenBot"],
  loginCount: 3,
};

/**
 * Starts with no CLI. Install puts one in place after a moment. Open 1Password stands for the user
 * turning on the CLI integration, which the next check finds. Connect then asks for one of two
 * accounts, as a CLI signed in to several does, and connects. A pasted token connects at once.
 */
export function createMockOnePasswordConnector(): OnePasswordConnectorDesktopApi {
  let status: OnePasswordConnectorStatus = {
    ...DISCONNECTED_ONEPASSWORD_CONNECTOR,
    setup: { cli: "missing", cliVersion: null, canInstall: true, appIntegration: null },
  };
  let appOpened = false;
  /** Each connect, cancel and disconnect replaces the connection that a connect waits for. */
  let attempt = 0;
  const listeners = new Set<(status: OnePasswordConnectorStatus) => void>();
  const set = (next: OnePasswordConnectorStatus): OnePasswordConnectorStatus => {
    status = next;
    for (const listener of listeners) listener({ ...status });
    return { ...status };
  };
  const disconnected = (): OnePasswordConnectorStatus => ({
    ...DISCONNECTED_ONEPASSWORD_CONNECTOR,
    setup: status.setup,
  });
  return {
    status: async () => ({ ...status }),
    checkSetup: async () => {
      if (status.setup.cli !== "ready") return { ...status };
      return set({ ...status, setup: { ...status.setup, appIntegration: appOpened } });
    },
    installCli: async () => {
      set({ ...status, error: null, setup: { ...status.setup, cli: "installing" } });
      await new Promise<void>((resolve) => setTimeout(resolve, MOCK_INSTALL_MS));
      return set({ ...status, setup: { ...READY, appIntegration: appOpened } });
    },
    openApp: async () => {
      appOpened = true;
    },
    connect: async ({ accountId }) => {
      attempt += 1;
      const current = attempt;
      if (!accountId)
        return set({
          ...disconnected(),
          state: "choose-account",
          accounts: [
            { id: "personal", label: "ada@example.com (my.1password.com)" },
            { id: "work", label: "ada@example.org (example.1password.com)" },
          ],
        });
      set({ ...disconnected(), state: "connecting" });
      await new Promise<void>((resolve) => setTimeout(resolve, MOCK_CONNECT_MS));
      if (current !== attempt) return { ...status };
      return set(CONNECTED);
    },
    connectWithToken: async () => {
      attempt += 1;
      return set({ ...CONNECTED, setup: status.setup });
    },
    cancel: async () => {
      attempt += 1;
      return set(disconnected());
    },
    disconnect: async () => {
      attempt += 1;
      return set(disconnected());
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
