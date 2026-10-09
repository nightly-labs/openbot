/** Only connection state crosses back to the renderer. The session key is never returned. */
export interface BitwardenConnectorStatus {
  connected: boolean;
}
