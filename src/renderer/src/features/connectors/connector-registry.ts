import type { ServerSummary } from "@openbot/contracts/ipc";
import { CONNECTOR_IDS, type ConnectorId } from "@openbot/ui/features/connectors/connectors";
import { createEffect, createMemo, untrack } from "solid-js";
import { createBitwardenConnector } from "./bitwarden-connector";
import { type BitwardenConnectorPort, bitwardenConnectorPort } from "./bitwarden-connector-port";
import { connectorAccess } from "./connector-access";
import type { ConnectorController } from "./connector-controller";
import { createGitHubConnector } from "./github-connector";
import type { GitHubConnectorPort } from "./github-connector-port";
import { createMessagingConnector, type MessagingApi, type MessagingConnectorOptions } from "./messaging-connector";
import { createOnePasswordConnector } from "./onepassword-connector";
import { type OnePasswordConnectorPort, onePasswordConnectorPort } from "./onepassword-connector-port";
import { createTelegramAccountConnector } from "./telegram-account-connector";
import { type TelegramAccountConnectorPort, telegramAccountConnectorPort } from "./telegram-account-connector-port";

/** The connectors of one place. A connector that the place cannot reach has no controller. */
export type ConnectorSet = Partial<Record<ConnectorId, ConnectorController>>;

/** How a place reaches each connector. Absent: the place does not have that connector. */
export interface ConnectorTransports {
  github?: () => GitHubConnectorPort;
  onePassword?: () => OnePasswordConnectorPort;
  bitwarden?: () => BitwardenConnectorPort;
  telegramAccount?: () => TelegramAccountConnectorPort;
  messaging?: MessagingApi;
}

/** This computer's transports, through main. */
export const LOCAL_CONNECTOR_TRANSPORTS = {
  onePassword: onePasswordConnectorPort,
  bitwarden: bitwardenConnectorPort,
  telegramAccount: telegramAccountConnectorPort,
} as const satisfies ConnectorTransports;

/**
 * Makes the controllers of one place once. Call it inside the component that owns them: each
 * subscription ends with it.
 */
export function createConnectorSet(transports: ConnectorTransports, options: MessagingConnectorOptions): ConnectorSet {
  const set: ConnectorSet = {};
  const { messaging } = transports;
  if (messaging) {
    set.slack = createMessagingConnector("slack", messaging, options);
    set.discord = createMessagingConnector("discord", messaging, options);
    set.telegram = createMessagingConnector("telegram", messaging, options);
  }
  if (transports.github) set.github = createGitHubConnector(transports.github, options.hostName);
  if (transports.onePassword) set.onepassword = createOnePasswordConnector(transports.onePassword, options.hostName);
  if (transports.bitwarden) set.bitwarden = createBitwardenConnector(transports.bitwarden, options.hostName);
  if (transports.telegramAccount)
    set["telegram-account"] = createTelegramAccountConnector(transports.telegramAccount, options.hostName);
  return set;
}

/**
 * One connector on one server. `unsupported`: the server could run it, but this build or its host
 * cannot, such as GitHub with no GitHub App. `loading`: that is not known before the first read.
 */
type ConnectorEntry =
  | { id: ConnectorId; access: "available"; controller: ConnectorController }
  | { id: ConnectorId; access: "local-only" | "hidden" | "unsupported" | "loading" };

/** The connectors of the server on screen, which every surface reads. */
export interface ConnectorRegistry {
  /** Every connector, in catalogue order. */
  entries: () => readonly ConnectorEntry[];
  get: (id: ConnectorId) => ConnectorEntry;
  /** The controllers of the available connectors. It changes only when one comes or goes. */
  available: () => readonly ConnectorController[];
  /** Reads the available connectors again, for a view that opens. */
  reload: () => void;
}

/**
 * The connectors of `server`: this computer's set for the local server, and the server set for a
 * joined one. The set reads its state again when the server changes.
 */
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
  /** The controllers that the server can reach, also those whose first read is still to come. */
  const reachable = () => {
    const current = server();
    const set = current?.kind === "local" ? sets.computer : sets.server;
    return CONNECTOR_IDS.flatMap((id) => {
      const controller = set[id];
      return controller && connectorAccess(id, current) === "available" ? [controller] : [];
    });
  };
  // Effects call it when a server or a view changes; what it reads must not make them run again.
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
  // GitHub tells its availability only after a read, so a new server is read before it can show. A
  // joined server's capabilities come after its id, so the connectors it can reach are part of the key.
  // The key is a memo because the server summary changes while a workspace loads, and an effect runs
  // again each time its key is computed.
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
  };
}
