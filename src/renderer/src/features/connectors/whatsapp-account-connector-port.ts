import type {
  OpenBotDesktopApi,
  WhatsAppAccountConnectorState,
  WhatsAppAccountConnectorStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

type DesktopWhatsAppAccount = OpenBotDesktopApi["whatsappAccountConnector"];

/** What the WhatsApp account page reaches: one connection, of this computer or of a joined server. */
export type WhatsAppAccountConnectorPort = Pick<
  DesktopWhatsAppAccount,
  "status" | "connect" | "submit" | "cancel" | "disconnect" | "setSending" | "onChanged"
>;

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function whatsappAccountConnectorPort(): WhatsAppAccountConnectorPort {
  const api = window.openbot.whatsappAccountConnector;
  return {
    status: () => api.status(),
    connect: (input) => api.connect(input),
    submit: (input) => api.submit(input),
    cancel: () => api.cancel(),
    disconnect: () => api.disconnect(),
    setSending: (enabled) => api.setSending(enabled),
    onChanged: (listener) => api.onChanged(listener),
  };
}

/** The actions of a joined server's connection (`whatsapp-account-connector-v1`). */
export type HostWhatsAppAccountActions = Omit<WhatsAppAccountConnectorPort, "onChanged">;

/** How often a joined server's connection is read while the host links. */
const HOST_POLL_MS = 2_000;
/**
 * The host stops a link after 10 minutes with no activity. After this many reads (10 minutes),
 * opening the page reads again.
 */
const HOST_POLL_LIMIT = 300;

/** The states of a link in progress: the host moves on, or replaces the QR code, with no event. */
const LINKING: ReadonlySet<WhatsAppAccountConnectorState> = new Set(["connecting", "qr", "phone", "code"]);

/**
 * A port to a joined server's connection. The host sends no event, so `onChanged` reads the status
 * while a link runs: the host replaces the QR code before it expires, and sees a scan or a typed code
 * by itself. The reads stop after `HOST_POLL_LIMIT` reads or when a read fails.
 */
export function polledWhatsAppAccountConnectorPort(actions: HostWhatsAppAccountActions): WhatsAppAccountConnectorPort {
  const listeners = new Set<(status: WhatsAppAccountConnectorStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reads = 0;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const seen = (status: WhatsAppAccountConnectorStatus) => {
    for (const listener of listeners) listener(status);
    if (!LINKING.has(status.state)) {
      stop();
      reads = 0;
    } else if (timer === null && listeners.size > 0 && reads < HOST_POLL_LIMIT)
      timer = setTimeout(() => {
        timer = null;
        reads += 1;
        void actions.status().then(seen, () => undefined);
      }, HOST_POLL_MS);
    return status;
  };
  /** A user action starts the reads again. */
  const act = async (action: () => Promise<WhatsAppAccountConnectorStatus>) => {
    reads = 0;
    return seen(await action());
  };
  return {
    status: () => act(() => actions.status()),
    connect: (input) => act(() => actions.connect(input)),
    submit: (input) => act(() => actions.submit(input)),
    cancel: () => act(() => actions.cancel()),
    disconnect: () => act(() => actions.disconnect()),
    setSending: (enabled) => act(() => actions.setSending(enabled)),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

/** The connection of the joined server that `serverId` names, through main. */
export function hostWhatsAppAccountConnectorPort(serverId: () => string | undefined): WhatsAppAccountConnectorPort {
  const server = () => {
    const id = serverId();
    if (!id) throw new Error(sourceText("error.team.connectorsUnsupported"));
    return id;
  };
  const api = () => window.openbot.whatsappAccountConnector;
  return polledWhatsAppAccountConnectorPort({
    status: async () => api().hostStatus(server()),
    connect: async (input) => api().hostConnect(input, server()),
    submit: async (input) => api().hostSubmit(input, server()),
    cancel: async () => api().hostCancel(server()),
    disconnect: async () => api().hostDisconnect(server()),
    setSending: async (enabled) => api().hostSetSending(enabled, server()),
  });
}
