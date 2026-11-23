import { isDynamicRecord, isString } from "./runtime-values";

export interface BitwardenConnectorStatus {
  connected: boolean;
  connecting: boolean;
  serverUrl: string | null;
  error: string | null;
}

export const DISCONNECTED_BITWARDEN_CONNECTOR: BitwardenConnectorStatus = {
  connected: false,
  connecting: false,
  serverUrl: null,
  error: null,
};

export interface BitwardenHostConnectInput {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  masterPassword: string;
}

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
