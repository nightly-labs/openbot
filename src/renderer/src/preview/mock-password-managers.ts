import {
  disconnectedPasswordManager,
  type OpenBotDesktopApi,
  type PasswordManagerId,
  type PasswordManagerStatus,
} from "@openbot/contracts/ipc";

type PasswordManagersApi = OpenBotDesktopApi["passwordManagers"];

const MOCK_SIGN_IN_MS = 2_500;
const MOCK_SETUP_MS = 1_500;
const MOCK_KEY_DAYS = 365;

const SIGN_IN_URL = "https://account.proton.me/authorize?app=proton-pass-cli";

function connected(manager: PasswordManagerId): PasswordManagerStatus {
  return {
    ...disconnectedPasswordManager(manager, ["browser", "key"]),
    state: "connected",
    vaultNames: ["Shared with OpenBot"],
    loginCount: 12,
    expiresAt: Date.now() + MOCK_KEY_DAYS * 24 * 60 * 60 * 1_000,
  };
}

export function createMockPasswordManagers(): PasswordManagersApi {
  const manager: PasswordManagerId = "protonpass";
  let status = disconnectedPasswordManager(manager, ["browser", "key"]);
  let attempt = 0;
  const listeners = new Set<(status: PasswordManagerStatus) => void>();
  const set = (next: PasswordManagerStatus): PasswordManagerStatus => {
    status = next;
    for (const listener of listeners) listener({ ...status });
    return { ...status };
  };
  const later = (current: number, ms: number, next: () => PasswordManagerStatus) => {
    setTimeout(() => {
      if (current === attempt) set(next());
    }, ms);
  };
  const reset = () => {
    attempt += 1;
    return set(disconnectedPasswordManager(manager, ["browser", "key"]));
  };
  const api = {
    list: async () => [{ ...status }],
    connect: async ({ method }) => {
      attempt += 1;
      const current = attempt;
      if (method.kind === "key") return set(connected(manager));
      const signingIn = { ...disconnectedPasswordManager(manager, ["browser", "key"]), state: "signing-in" as const };
      later(current, MOCK_SIGN_IN_MS, () => ({ ...signingIn, step: "setup" }));
      later(current, MOCK_SIGN_IN_MS + MOCK_SETUP_MS, () => connected(manager));
      return set({ ...signingIn, step: "browser", signInUrl: SIGN_IN_URL });
    },
    cancel: async () => reset(),
    disconnect: async () => reset(),
    openSignIn: async () => undefined,
    onChanged: (listener: (status: PasswordManagerStatus) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } satisfies Omit<PasswordManagersApi, `host${string}`>;
  return {
    ...api,
    hostList: () => api.list(),
    hostConnect: (input) => api.connect(input),
    hostCancel: () => api.cancel(),
    hostDisconnect: () => api.disconnect(),
    hostOpenSignIn: () => api.openSignIn(),
  };
}
