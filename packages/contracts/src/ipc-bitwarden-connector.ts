import { isDynamicRecord, isString } from "./runtime-values";

/** Only connection state crosses back to the renderer. The session key and the API key are never returned. */
export interface BitwardenConnectorStatus {
  connected: boolean;
  /** True while the host signs in and unlocks with an API key (`bitwarden-connector-v1`). */
  connecting: boolean;
  /** The vault server of a connection made with an API key, or null for a session key. */
  serverUrl: string | null;
  /** The last failure of a connection made with an API key, as a sentence. */
  error: string | null;
}

export const DISCONNECTED_BITWARDEN_CONNECTOR: BitwardenConnectorStatus = {
  connected: false,
  connecting: false,
  serverUrl: null,
  error: null,
};

/**
 * A personal API key and the master password for a joined server's connection
 * (`bitwarden-connector-v1`). `serverUrl` is the Bitwarden or Vaultwarden server.
 */
export interface BitwardenHostConnectInput {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  masterPassword: string;
}

/**
 * The status of a joined server's connection (`bitwarden-connector-v1`), in the desktop shape. A state
 * that this build does not know shows as not connected. Throws for a value that is not a host status.
 */
export function decodeHostBitwardenConnectorStatus(value: unknown): BitwardenConnectorStatus {
  if (
    !isDynamicRecord(value) ||
    !isString(value.state) ||
    !(value.serverUrl === null || isString(value.serverUrl)) ||
    !(value.error === null || isString(value.error))
  ) {
    throw new Error("Invalid Bitwarden connector response.");
  }
  return {
    connected: value.state === "connected",
    connecting: value.state === "connecting",
    serverUrl: value.serverUrl,
    error: value.error,
  };
}
