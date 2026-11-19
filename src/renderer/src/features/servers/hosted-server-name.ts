import { parseHostedServerName } from "@openbot/contracts/hosted-servers";

/** The brand word. No catalog translates it, and its slug is long enough for a host address. */
export const FALLBACK_SERVER_NAME = "OpenBot";

/**
 * The default name of a new hosted server, from the name in the language of the interface. A name in a
 * script with no Latin letters, such as "云服务器", has no slug for a host address, so the account server
 * refuses it. Then the brand word goes before it: "OpenBot 云服务器".
 */
export function hostedServerDefaultName(translated: string): string {
  return (
    parseHostedServerName(translated) ??
    parseHostedServerName(`${FALLBACK_SERVER_NAME} ${translated}`) ??
    FALLBACK_SERVER_NAME
  );
}
