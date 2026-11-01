import { CONNECTOR_IDS, type ConnectorId } from "@openbot/contracts/ipc";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { CONNECTORS_CAPABILITY } from "@openbot/contracts/team-protocol/connectors-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { TELEGRAM_ACCOUNT_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/telegram-account-connector-v1";

export { CONNECTOR_IDS, type ConnectorId } from "@openbot/contracts/ipc";

export interface ConnectorDefinition {
  /**
   * The capability that lets a joined server run the connector for an owner or admin. Null when the
   * connector works only on the computer that runs OpenBot, because its app or browser runs there.
   */
  server: TeamCurrentCapability | null;
}

export const CONNECTORS: Readonly<Record<ConnectorId, ConnectorDefinition>> = {
  slack: { server: CONNECTORS_CAPABILITY },
  discord: { server: CONNECTORS_CAPABILITY },
  telegram: { server: CONNECTORS_CAPABILITY },
  github: { server: CONNECTORS_CAPABILITY },
  onepassword: { server: ONEPASSWORD_CONNECTOR_CAPABILITY },
  bitwarden: { server: BITWARDEN_CONNECTOR_CAPABILITY },
  "telegram-account": { server: TELEGRAM_ACCOUNT_CONNECTOR_CAPABILITY },
};

const CONNECTOR_ID_SET = new Set<string>(CONNECTOR_IDS);

export function isConnectorId(value: string): value is ConnectorId {
  return CONNECTOR_ID_SET.has(value);
}
