import {
  type BitwardenConnectorStatus,
  DISCONNECTED_BITWARDEN_CONNECTOR,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";

/** This computer's connection and one joined server's, which connects at once with any input. */
export function createMockBitwardenConnector(): OpenBotDesktopApi["bitwardenConnector"] {
  let status: BitwardenConnectorStatus = DISCONNECTED_BITWARDEN_CONNECTOR;
  let host: BitwardenConnectorStatus = DISCONNECTED_BITWARDEN_CONNECTOR;
  const listeners = new Set<(status: BitwardenConnectorStatus) => void>();
  const change = (next: BitwardenConnectorStatus) => {
    status = next;
    for (const listener of listeners) listener(status);
    return status;
  };
  return {
    status: async () => status,
    connect: async () => change({ ...DISCONNECTED_BITWARDEN_CONNECTOR, connected: true }),
    disconnect: async () => change(DISCONNECTED_BITWARDEN_CONNECTOR),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hostStatus: async () => host,
    hostConnect: async ({ serverUrl }) => {
      host = { ...DISCONNECTED_BITWARDEN_CONNECTOR, connected: true, serverUrl };
      return host;
    },
    hostDisconnect: async () => {
      host = DISCONNECTED_BITWARDEN_CONNECTOR;
      return host;
    },
  };
}
