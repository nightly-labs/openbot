import type { ServerSummary } from "@openbot/contracts/ipc";
import { CONNECTOR_IDS, type ConnectorId } from "@openbot/ui/features/connectors/connectors";
import { createEffect, createMemo, untrack } from "solid-js";
import { serverRoleCanAdminister } from "../servers/server-capabilities";
import { createBitwardenConnector } from "./bitwarden-connector";
import { type BitwardenConnectorPort, bitwardenConnectorPort } from "./bitwarden-connector-port";
import { connectorAccess } from "./connector-access";
import type { ConnectorController } from "./connector-controller";
import { createGitHubConnector } from "./github-connector";
import type { GitHubConnectorPort } from "./github-connector-port";
import { createMessagingConnector, type MessagingApi, type MessagingConnectorOptions } from "./messaging-connector";
import { createOnePasswordConnector } from "./onepassword-connector";
import { type OnePasswordConnectorPort, onePasswordConnectorPort } from "./onepassword-connector-port";
import { createPasswordManagerConnector } from "./password-manager-connector";
import { type PasswordManagerPort, passwordManagerPort } from "./password-manager-port";
import { createWhatsAppConnector, type WhatsAppPort } from "./whatsapp-connector";

export type ConnectorSet = Partial<Record<ConnectorId, ConnectorController>>;

export interface ConnectorTransports {
  github?: () => GitHubConnectorPort;
  onePassword?: () => OnePasswordConnectorPort;
  bitwarden?: () => BitwardenConnectorPort;
  passwordManagers?: () => PasswordManagerPort;
  messaging?: MessagingApi;
  whatsapp?: () => WhatsAppPort;
}

export const LOCAL_CONNECTOR_TRANSPORTS = {
  onePassword: onePasswordConnectorPort,
  bitwarden: bitwardenConnectorPort,
  passwordManagers: passwordManagerPort,
} as const satisfies ConnectorTransports;

export function createConnectorSet(transports: ConnectorTransports, options: MessagingConnectorOptions): ConnectorSet {
  const set: ConnectorSet = {};
  const { messaging } = transports;
  if (messaging) {
    set.slack = createMessagingConnector("slack", messaging, options);
    set.discord = createMessagingConnector("discord", messaging, options);
    set.telegram = createMessagingConnector("telegram", messaging, options);
  }
  if (transports.whatsapp) set.whatsapp = createWhatsAppConnector(transports.whatsapp, options);
  if (transports.github) set.github = createGitHubConnector(transports.github, options.hostName);
  if (transports.onePassword) set.onepassword = createOnePasswordConnector(transports.onePassword, options.hostName);
  if (transports.bitwarden) set.bitwarden = createBitwardenConnector(transports.bitwarden, options.hostName);
  if (transports.passwordManagers) {
    set.protonpass = createPasswordManagerConnector("protonpass", transports.passwordManagers, options.hostName);
  }
  return set;
}

type ConnectorEntry =
  | { id: ConnectorId; access: "available"; controller: ConnectorController }
  | { id: ConnectorId; access: "local-only" | "hidden" | "unsupported" | "loading" };

export interface ConnectorRegistry {
  entries: () => readonly ConnectorEntry[];
  get: (id: ConnectorId) => ConnectorEntry;
  available: () => readonly ConnectorController[];
  reload: () => void;
  canManage: () => boolean;
}

export function createConnectorRegistry(
  server: () => ServerSummary | undefined,
  sets: { computer: ConnectorSet; server: ConnectorSet },
): ConnectorRegistry {
  const entries = createMemo((): readonly ConnectorEntry[] => {
    const current = server();
    const set = current?.kind === "local" ? sets.computer : sets.server;
    return CONNECTOR_IDS.map((id): ConnectorEntry => {
      const access = connectorAccess(id, current);
      if (access !== "available") return { id, access };
      const controller = set[id];
      if (controller?.available()) return { id, access, controller };
      return { id, access: controller && !controller.ready() ? "loading" : "unsupported" };
    });
  });
  const reachable = () => {
    const current = server();
    const set = current?.kind === "local" ? sets.computer : sets.server;
    return CONNECTOR_IDS.flatMap((id) => {
      const controller = set[id];
      return controller && connectorAccess(id, current) === "available" ? [controller] : [];
    });
  };
  const reload = () =>
    untrack(() => {
      for (const controller of reachable()) controller.reload();
    });
  const available = createMemo(
    () => entries().flatMap((entry) => (entry.access === "available" ? [entry.controller] : [])),
    {
      equals: (before, after) => before.length === after.length && before.every((item, index) => item === after[index]),
    },
  );
  createEffect(
    createMemo(() => {
      const id = server()?.id;
      return id ? `${id}:${reachable().map((controller) => controller.id)}` : undefined;
    }),
    (key) => {
      if (key) reload();
    },
  );
  return {
    entries,
    get: (id) => entries().find((entry) => entry.id === id) ?? { id, access: "hidden" },
    available,
    reload,
    canManage: () => {
      const current = server();
      return current?.kind !== "remote" || serverRoleCanAdminister(current);
    },
  };
}
