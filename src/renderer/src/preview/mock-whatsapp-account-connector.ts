import {
  DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR,
  type WhatsAppAccountConnectorDesktopApi,
  type WhatsAppAccountConnectorStatus,
  type WhatsAppAccountSubmitInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

/** How long the mock WhatsApp takes between two steps, and until the phone "links". */
const MOCK_STEP_MS = 800;
const MOCK_LINK_MS = 6_000;

const CONNECTED: WhatsAppAccountConnectorStatus = {
  ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR,
  state: "connected",
  account: { name: "Ada Lovelace", phone: "+4860***200" },
  history: { chats: 42, messages: 1_318 },
};

/**
 * Connect shows a QR code that the mock phone "scans" after a few seconds, or asks for the number and
 * then shows a code that the mock phone "types" after a few seconds.
 */
export function createMockWhatsAppAccountConnector(): WhatsAppAccountConnectorDesktopApi {
  let status: WhatsAppAccountConnectorStatus = { ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR };
  let sendingEnabled = false;
  /** Each connect, cancel and disconnect replaces the link that a timer waits for. */
  let attempt = 0;
  const listeners = new Set<(status: WhatsAppAccountConnectorStatus) => void>();
  const set = (next: WhatsAppAccountConnectorStatus): WhatsAppAccountConnectorStatus => {
    status = { ...next, sendingEnabled };
    for (const listener of listeners) listener({ ...status });
    return { ...status };
  };
  const later = (current: number, next: () => WhatsAppAccountConnectorStatus, delay = MOCK_STEP_MS) => {
    setTimeout(() => {
      if (current === attempt) set(next());
    }, delay);
  };
  const step = (patch: Partial<WhatsAppAccountConnectorStatus>): WhatsAppAccountConnectorStatus => ({
    ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR,
    method: status.method,
    ...patch,
  });
  const api = {
    status: async () => ({ ...status }),
    connect: async ({ method }) => {
      if (status.state === "connected") return { ...status };
      attempt += 1;
      const current = attempt;
      if (method === "qr") {
        later(current, () =>
          step({
            state: "qr",
            method,
            qrCode: "2@mock-reference,mock-noise-key,mock-identity-key,mock-secret",
            qrExpiresAt: Date.now() + 60_000,
          }),
        );
        later(current, () => CONNECTED, MOCK_LINK_MS);
      } else later(current, () => step({ state: "phone", method }));
      return set(step({ state: "connecting", method }));
    },
    // The mock takes any number.
    submit: async (_input: WhatsAppAccountSubmitInput) => {
      const current = attempt;
      if (status.state !== "phone")
        return set({ ...status, error: sourceText("error.connector.whatsappAccountMovedOn") });
      later(current, () => step({ state: "code", pairingCode: "ABCD-1234" }));
      later(current, () => CONNECTED, MOCK_LINK_MS);
      return set(step({ state: "connecting" }));
    },
    cancel: async () => {
      attempt += 1;
      if (status.state === "connected") return { ...status };
      return set({ ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR });
    },
    disconnect: async () => {
      attempt += 1;
      sendingEnabled = false;
      return set({ ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR });
    },
    setSending: async (enabled: boolean) => {
      if (status.state !== "connected") return { ...status };
      sendingEnabled = enabled;
      return set(status);
    },
    onChanged: (listener: (status: WhatsAppAccountConnectorStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies Omit<WhatsAppAccountConnectorDesktopApi, `host${string}`>;
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
