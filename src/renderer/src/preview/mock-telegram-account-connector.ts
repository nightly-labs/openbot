import {
  DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR,
  type TelegramAccountConnectorDesktopApi,
  type TelegramAccountConnectorStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

/** How long the mock Telegram takes between two steps, and until the QR code is "scanned". */
const MOCK_STEP_MS = 800;
const MOCK_SCAN_MS = 6_000;
/** The code that makes the mock account ask for its two-step password. */
const MOCK_PASSWORD_CODE = "22222";

const CONNECTED: TelegramAccountConnectorStatus = {
  ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR,
  state: "connected",
  account: { name: "Ada Lovelace", username: "ada", phone: "+4860***200" },
};

/**
 * Starts with no API credentials. Connect with them, or with none after the first time, shows a QR
 * code that the mock phone "scans" after a few seconds, or asks for the number, then the code. The
 * code 22222 also asks for the two-step password. Any other value goes on to the next step.
 */
export function createMockTelegramAccountConnector(): TelegramAccountConnectorDesktopApi {
  let status: TelegramAccountConnectorStatus = { ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR };
  let hasCredentials = false;
  let sendingEnabled = false;
  /** Each connect, cancel and disconnect replaces the sign-in that a timer waits for. */
  let attempt = 0;
  const listeners = new Set<(status: TelegramAccountConnectorStatus) => void>();
  const set = (next: TelegramAccountConnectorStatus): TelegramAccountConnectorStatus => {
    status = { ...next, sendingEnabled };
    for (const listener of listeners) listener({ ...status });
    return { ...status };
  };
  const later = (current: number, next: () => TelegramAccountConnectorStatus, delay = MOCK_STEP_MS) => {
    setTimeout(() => {
      if (current === attempt) set(next());
    }, delay);
  };
  const step = (patch: Partial<TelegramAccountConnectorStatus>): TelegramAccountConnectorStatus => ({
    ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR,
    method: status.method,
    ...patch,
  });
  const api = {
    status: async () => ({ ...status }),
    connect: async ({ method, apiId, apiHash }) => {
      if (status.state === "connected") return { ...status };
      if (apiId !== null && apiHash !== null) hasCredentials = true;
      if (!hasCredentials)
        return set({
          ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR,
          error: sourceText("error.connector.telegramAccountCredentialsMissing"),
        });
      attempt += 1;
      const current = attempt;
      if (method === "qr") {
        later(current, () =>
          step({
            state: "qr",
            method,
            qrUrl: "tg://login?token=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
            qrExpiresAt: Date.now() + 30_000,
          }),
        );
        later(current, () => CONNECTED, MOCK_SCAN_MS);
      } else {
        later(current, () => step({ state: "phone", method }));
      }
      return set(step({ state: "connecting", method }));
    },
    submit: async ({ field, value }) => {
      const current = attempt;
      if (field === "phone" && status.state === "phone") {
        later(current, () => step({ state: "code", codeViaApp: true }));
        return set(step({ state: "connecting" }));
      }
      if (field === "code" && status.state === "code") {
        later(current, () =>
          value.trim() === MOCK_PASSWORD_CODE ? step({ state: "password", passwordHint: "first pet" }) : CONNECTED,
        );
        return set(step({ state: "connecting" }));
      }
      if (field === "password" && status.state === "password") {
        later(current, () => CONNECTED);
        return set(step({ state: "connecting" }));
      }
      return set({ ...status, error: sourceText("error.connector.telegramAccountMovedOn") });
    },
    cancel: async () => {
      attempt += 1;
      if (status.state === "connected") return { ...status };
      return set({ ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR });
    },
    disconnect: async () => {
      attempt += 1;
      sendingEnabled = false;
      return set({ ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR });
    },
    setSending: async (enabled: boolean) => {
      if (status.state !== "connected") return { ...status };
      sendingEnabled = enabled;
      return set(status);
    },
    onChanged: (listener: (status: TelegramAccountConnectorStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies Omit<TelegramAccountConnectorDesktopApi, `host${string}`>;
  // The preview has one connection, so a joined server shows the same one.
  return {
    ...api,
    hostStatus: api.status,
    hostConnect: (input) => api.connect(input),
    hostSubmit: (input) => api.submit(input),
    hostCancel: api.cancel,
    hostDisconnect: api.disconnect,
    hostSetSending: (enabled) => api.setSending(enabled),
  };
}
