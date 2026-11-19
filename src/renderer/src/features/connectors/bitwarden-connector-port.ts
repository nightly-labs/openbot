import type { BitwardenConnectorStatus, BitwardenHostConnectInput, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

type DesktopBitwarden = OpenBotDesktopApi["bitwardenConnector"];

export type BitwardenConnectorPort = Pick<DesktopBitwarden, "status" | "connect" | "disconnect" | "onChanged"> & {
  connectHost: (input: BitwardenHostConnectInput) => Promise<BitwardenConnectorStatus>;
};

const unsupported = () => Promise.reject(new Error(sourceText("error.team.connectorsUnsupported")));

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

export type HostBitwardenActions = Pick<BitwardenConnectorPort, "status" | "connectHost" | "disconnect">;

const HOST_POLL_MS = 2_000;
const HOST_POLL_LIMIT = 240;

export function polledBitwardenConnectorPort(actions: HostBitwardenActions): BitwardenConnectorPort {
  const listeners = new Set<(status: BitwardenConnectorStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reads = 0;
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
