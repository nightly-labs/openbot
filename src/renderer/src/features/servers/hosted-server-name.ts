import { parseHostedServerName } from "@openbot/contracts/hosted-servers";

export const FALLBACK_SERVER_NAME = "OpenBot";

export function hostedServerDefaultName(translated: string): string {
  return (
    parseHostedServerName(translated) ??
    parseHostedServerName(`${FALLBACK_SERVER_NAME} ${translated}`) ??
    FALLBACK_SERVER_NAME
  );
}
