import type { OnePasswordConnectorStatus, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

export type OnePasswordConnectorPort = Omit<
  OpenBotDesktopApi["onePasswordConnector"],
  "hostStatus" | "hostConnectWithToken" | "hostDisconnect"
>;

export function onePasswordConnectorPort(): OnePasswordConnectorPort {
  return window.openbot.onePasswordConnector;
}

export type HostOnePasswordActions = Pick<OnePasswordConnectorPort, "status" | "connectWithToken" | "disconnect">;

const HOST_POLL_MS = 2_000;
const HOST_POLL_LIMIT = 15;

export function polledOnePasswordConnectorPort(actions: HostOnePasswordActions): OnePasswordConnectorPort {
  const listeners = new Set<(status: OnePasswordConnectorStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reads = 0;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const seen = (status: OnePasswordConnectorStatus) => {
    for (const listener of listeners) listener(status);
    const waiting = status.state === "connecting" || (status.state === "connected" && status.loginCount === null);
    if (!waiting) {
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
  const unsupported = () => Promise.reject(new Error(sourceText("error.team.connectorsUnsupported")));
  return {
    status: async () => seen(await actions.status()),
    checkSetup: async () => {
      reads = 0;
      return seen(await actions.status());
    },
    installCli: unsupported,
    openApp: unsupported,
    connect: unsupported,
    connectWithToken: async (token) => {
      reads = 0;
      return seen(await actions.connectWithToken(token));
    },
    cancel: async () => seen(await actions.status()),
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

export function hostOnePasswordConnectorPort(serverId: () => string | undefined): OnePasswordConnectorPort {
  const server = () => {
    const id = serverId();
    if (!id) throw new Error(sourceText("error.team.connectorsUnsupported"));
    return id;
  };
  const api = () => window.openbot.onePasswordConnector;
  return polledOnePasswordConnectorPort({
    status: async () => api().hostStatus(server()),
    connectWithToken: async (token) => api().hostConnectWithToken({ token }, server()),
    disconnect: async () => api().hostDisconnect(server()),
  });
}
