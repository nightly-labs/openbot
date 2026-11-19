import { CONNECTOR_IDS, type ConnectorId } from "@openbot/contracts/ipc";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { CONNECTORS_CAPABILITY } from "@openbot/contracts/team-protocol/connectors-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { PASSWORD_MANAGERS_CAPABILITY } from "@openbot/contracts/team-protocol/password-managers-v1";
import { WHATSAPP_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/whatsapp-connector-v1";

export { CONNECTOR_IDS, type ConnectorId } from "@openbot/contracts/ipc";

export interface ConnectorDefinition {
  server: TeamCurrentCapability | null;
}

export const CONNECTORS: Readonly<Record<ConnectorId, ConnectorDefinition>> = {
  slack: { server: CONNECTORS_CAPABILITY },
  discord: { server: CONNECTORS_CAPABILITY },
  telegram: { server: CONNECTORS_CAPABILITY },
  whatsapp: { server: WHATSAPP_CONNECTOR_CAPABILITY },
  github: { server: CONNECTORS_CAPABILITY },
  onepassword: { server: ONEPASSWORD_CONNECTOR_CAPABILITY },
  bitwarden: { server: BITWARDEN_CONNECTOR_CAPABILITY },
  protonpass: { server: PASSWORD_MANAGERS_CAPABILITY },
};

const CONNECTOR_ID_SET = new Set<string>(CONNECTOR_IDS);

export function isConnectorId(value: string): value is ConnectorId {
  return CONNECTOR_ID_SET.has(value);
}
