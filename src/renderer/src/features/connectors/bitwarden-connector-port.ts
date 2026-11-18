import type { BitwardenConnectorStatus, BitwardenHostConnectInput, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

type DesktopBitwarden = OpenBotDesktopApi["bitwardenConnector"];

/** What the Bitwarden page reaches: one connection, of this computer or of a joined server. */
export type BitwardenConnectorPort = Pick<DesktopBitwarden, "status" | "connect" | "disconnect" | "onChanged"> & {
  /** Connects a joined server with an API key and the master password. This computer's port rejects it. */
  connectHost: (input: BitwardenHostConnectInput) => Promise<BitwardenConnectorStatus>;
};

const unsupported = () => Promise.reject(new Error(sourceText("error.team.connectorsUnsupported")));

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function bitwardenConnectorPort(): BitwardenConnectorPort {
  const api = window.openbot.bitwardenConnector;
  return {
    status: () => api.status(),
    connect: (key) => api.connect(key),
    disconnect: () => api.disconnect(),
    onChanged: (listener) => api.onChanged(listener),
    connectHost: unsupported,
  };
}

/** The actions of a joined server's connection (`bitwarden-connector-v1`). */
export type HostBitwardenActions = Pick<BitwardenConnectorPort, "status" | "connectHost" | "disconnect">;

/** How often a joined server's connection is read while the host signs in. */
const HOST_POLL_MS = 2_000;
/**
 * The first sign-in can download `bw`, which the host waits for up to 5 minutes, then syncs. After
 * this many reads (8 minutes), opening the page reads again.
 */
const HOST_POLL_LIMIT = 240;

/**
 * A port to a joined server's connection. The host sends no event, so `onChanged` reads the status
 * while the host signs in, and stops when the host is no longer signing in or after
 * `HOST_POLL_LIMIT` reads. A failed read counts as a read: one dropped request does not leave the
 * page on "Connecting". A session key from this computer cannot open the host's vault, so `connect`
 * fails.
 */
export function polledBitwardenConnectorPort(actions: HostBitwardenActions): BitwardenConnectorPort {
  const listeners = new Set<(status: BitwardenConnectorStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reads = 0;
  /** Whether the last status that came was `connecting`. Only then does a failed read try again. */
  let connecting = false;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    if (!connecting || timer !== null || listeners.size === 0 || reads >= HOST_POLL_LIMIT) return;
    timer = setTimeout(() => {
      timer = null;
      reads += 1;
      void actions.status().then(seen, schedule);
    }, HOST_POLL_MS);
  };
  const seen = (status: BitwardenConnectorStatus) => {
    for (const listener of listeners) listener(status);
    connecting = status.connecting;
    if (!connecting) {
      stop();
      reads = 0;
    } else schedule();
    return status;
  };
  return {
    status: async () => {
      reads = 0;
      return seen(await actions.status());
    },
    connect: unsupported,
    connectHost: async (input) => {
      reads = 0;
      return seen(await actions.connectHost(input));
    },
    disconnect: async () => seen(await actions.disconnect()),
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
export function hostBitwardenConnectorPort(serverId: () => string | undefined): BitwardenConnectorPort {
  const server = () => {
    const id = serverId();
    if (!id) throw new Error(sourceText("error.team.connectorsUnsupported"));
    return id;
  };
  const api = () => window.openbot.bitwardenConnector;
  return polledBitwardenConnectorPort({
    status: async () => api().hostStatus(server()),
    connectHost: async (input) => api().hostConnect(input, server()),
    disconnect: async () => api().hostDisconnect(server()),
  });
}
