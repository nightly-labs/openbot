import type {
  OpenBotDesktopApi,
  TelegramAccountConnectorState,
  TelegramAccountConnectorStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

type DesktopTelegramAccount = OpenBotDesktopApi["telegramAccountConnector"];

/** Where the user gets the api_id and api_hash of a Telegram app. */
export const TELEGRAM_APPS_URL = "https://my.telegram.org";

/** What the Telegram account page reaches: one connection, of this computer or of a joined server. */
export type TelegramAccountConnectorPort = Pick<
  DesktopTelegramAccount,
  "status" | "connect" | "submit" | "cancel" | "disconnect" | "setSending" | "onChanged"
> & {
  /** Opens my.telegram.org in the browser of the user. */
  openApps: () => Promise<void>;
};

/** Opens my.telegram.org from the desktop app, in the default browser. */
const openAppsOnDesktop = () => window.openbot.openUrl(TELEGRAM_APPS_URL);

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function telegramAccountConnectorPort(): TelegramAccountConnectorPort {
  const api = window.openbot.telegramAccountConnector;
  return {
    status: () => api.status(),
    connect: (input) => api.connect(input),
    submit: (input) => api.submit(input),
    cancel: () => api.cancel(),
    disconnect: () => api.disconnect(),
    setSending: (enabled) => api.setSending(enabled),
    onChanged: (listener) => api.onChanged(listener),
    openApps: openAppsOnDesktop,
  };
}

/** The actions of a joined server's connection (`telegram-account-connector-v1`). */
export type HostTelegramAccountActions = Omit<TelegramAccountConnectorPort, "onChanged" | "openApps">;

/** How often a joined server's connection is read while the host signs in. */
const HOST_POLL_MS = 2_000;
/**
 * The host stops a sign-in after 10 minutes with no activity. After this many reads (10 minutes),
 * opening the page reads again.
 */
const HOST_POLL_LIMIT = 300;

/** The states of a sign-in in progress: the host moves on, or replaces the QR code, with no event. */
const SIGNING_IN: ReadonlySet<TelegramAccountConnectorState> = new Set([
  "connecting",
  "qr",
  "phone",
  "code",
  "password",
]);

/**
 * A port to a joined server's connection. The host sends no event, so `onChanged` reads the status
 * while a sign-in runs: the host replaces the QR code before it expires, and sees a scan or a step by
 * itself. The reads stop after `HOST_POLL_LIMIT` reads or when a read fails.
 */
export function polledTelegramAccountConnectorPort(
  actions: HostTelegramAccountActions,
  openApps: () => Promise<void>,
): TelegramAccountConnectorPort {
  const listeners = new Set<(status: TelegramAccountConnectorStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reads = 0;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const seen = (status: TelegramAccountConnectorStatus) => {
    for (const listener of listeners) listener(status);
    if (!SIGNING_IN.has(status.state)) {
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
  const act = async (action: () => Promise<TelegramAccountConnectorStatus>) => {
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
    openApps,
  };
}

/** The connection of the joined server that `serverId` names, through main. */
export function hostTelegramAccountConnectorPort(serverId: () => string | undefined): TelegramAccountConnectorPort {
  const server = () => {
    const id = serverId();
    if (!id) throw new Error(sourceText("error.team.connectorsUnsupported"));
    return id;
  };
  const api = () => window.openbot.telegramAccountConnector;
  return polledTelegramAccountConnectorPort(
    {
      status: async () => api().hostStatus(server()),
      connect: async (input) => api().hostConnect(input, server()),
      submit: async (input) => api().hostSubmit(input, server()),
      cancel: async () => api().hostCancel(server()),
      disconnect: async () => api().hostDisconnect(server()),
      setSending: async (enabled) => api().hostSetSending(enabled, server()),
    },
    openAppsOnDesktop,
  );
}
