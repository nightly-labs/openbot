// The Bitwarden connection of this computer: connect with a session key, and disconnect. The `host*`
// endpoints read, connect with an API key and the master password, and disconnect a joined server's
// connection (`bitwarden-connector-v1`).

import { type BitwardenHostConnectInput, decodeHostBitwardenConnectorStatus } from "@openbot/contracts/ipc";
import {
  BITWARDEN_CONNECTOR_CAPABILITY,
  BITWARDEN_CONNECTOR_KEY_LIMIT,
  BITWARDEN_CONNECTOR_PASSWORD_LIMIT,
  BITWARDEN_CONNECTOR_ROUTES,
  BITWARDEN_CONNECTOR_URL_LIMIT,
} from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { BitwardenConnectorService } from "../bitwarden-connector-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { isObject, requireString, stringPayload } from "./validation";

export interface BitwardenConnectorIpcDependencies {
  bitwardenConnector: Pick<BitwardenConnectorService, "status" | "connect" | "connectWithApiKey" | "disconnect">;
  remoteServers: {
    supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  };
}

function decodeHostConnectInput(value: unknown): BitwardenHostConnectInput {
  if (!isObject(value)) throw new Error("Invalid Bitwarden connect input.");
  const input = {
    serverUrl: requireString(value.serverUrl, "serverUrl", BITWARDEN_CONNECTOR_URL_LIMIT).trim(),
    clientId: requireString(value.clientId, "clientId", BITWARDEN_CONNECTOR_KEY_LIMIT).trim(),
    clientSecret: requireString(value.clientSecret, "clientSecret", BITWARDEN_CONNECTOR_KEY_LIMIT).trim(),
    masterPassword: requireString(value.masterPassword, "masterPassword", BITWARDEN_CONNECTOR_PASSWORD_LIMIT),
  };
  registerSecretValue(input.clientId);
  registerSecretValue(input.clientSecret);
  registerSecretValue(input.masterPassword, { allowShort: true });
  return input;
}

export function bitwardenConnectorIpcHandlers({
  bitwardenConnector,
  remoteServers,
}: BitwardenConnectorIpcDependencies): Pick<IpcGroupHandlers, "bitwardenConnector"> {
  function post(serverId: string, path: string, body: BitwardenHostConnectInput | Record<string, never> = {}) {
    if (!remoteServers.supportsCapability(serverId, BITWARDEN_CONNECTOR_CAPABILITY))
      throw new Error(sourceText("error.team.connectorsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeHostBitwardenConnectorStatus, { method: "POST", body }),
    );
  }

  return {
    bitwardenConnector: {
      status: handler(() => bitwardenConnector.status()),
      connect: payloadHandler(stringPayload("sessionKey", 4096), (key) =>
        runCauseEffect(bitwardenConnector.connect(key)),
      ),
      disconnect: handler(() => runCauseEffect(bitwardenConnector.disconnect())),
      hostStatus: scopedQueryHandler({
        local: () => bitwardenConnector.status(),
        remote: (serverId) => post(serverId, BITWARDEN_CONNECTOR_ROUTES.status),
      }),
      hostConnect: scopedHandler(decodeHostConnectInput, {
        local: (input) => runCauseEffect(bitwardenConnector.connectWithApiKey(input)),
        remote: (input, serverId) => post(serverId, BITWARDEN_CONNECTOR_ROUTES.connect, input),
      }),
      hostDisconnect: scopedQueryHandler({
        local: () => runCauseEffect(bitwardenConnector.disconnect()),
        remote: (serverId) => post(serverId, BITWARDEN_CONNECTOR_ROUTES.disconnect),
      }),
    },
  };
}
