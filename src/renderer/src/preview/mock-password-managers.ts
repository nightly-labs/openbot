import {
  disconnectedPasswordManager,
  type OpenBotDesktopApi,
  type PasswordManagerId,
  type PasswordManagerStatus,
} from "@openbot/contracts/ipc";

type PasswordManagersApi = OpenBotDesktopApi["passwordManagers"];

/** How long the mock sign-in takes in the browser, and to make the vault and its key. */
const MOCK_SIGN_IN_MS = 2_500;
const MOCK_SETUP_MS = 1_500;
/** The mock key expires one year after it is made. */
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

/**
 * Proton Pass only. A browser connection names the sign-in page, then the user signs in in the
 * browser, then the host makes the vault and its key. An access key connects at once. The preview
 * opens no page: "Open again" does nothing.
 */
export function createMockPasswordManagers(): PasswordManagersApi {
  const manager: PasswordManagerId = "protonpass";
  let status = disconnectedPasswordManager(manager, ["browser", "key"]);
  /** Each connect, cancel and disconnect replaces the sign-in that a timer waits for. */
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
  // The preview has one connection, so a joined server shows the same one.
  return {
    ...api,
    hostList: () => api.list(),
    hostConnect: (input) => api.connect(input),
    hostCancel: () => api.cancel(),
    hostDisconnect: () => api.disconnect(),
    hostOpenSignIn: () => api.openSignIn(),
  };
}
