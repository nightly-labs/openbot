import {
  DISCONNECTED_ONEPASSWORD_CONNECTOR,
  type OnePasswordConnectorDesktopApi,
  type OnePasswordConnectorStatus,
  type OnePasswordSetup,
} from "@openbot/contracts/ipc";

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

export function createMockOnePasswordConnector(): OnePasswordConnectorDesktopApi {
  let status: OnePasswordConnectorStatus = {
    ...DISCONNECTED_ONEPASSWORD_CONNECTOR,
    setup: { cli: "missing", cliVersion: null, canInstall: true, appIntegration: null },
  };
  let appOpened = false;
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
  const api = {
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
    connectWithToken: async (_token: string) => {
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
    onChanged: (listener: (status: OnePasswordConnectorStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies Omit<OnePasswordConnectorDesktopApi, `host${string}`>;
  return {
    ...api,
    hostStatus: api.status,
    hostConnectWithToken: ({ token }) => api.connectWithToken(token),
    hostDisconnect: api.disconnect,
  };
}
