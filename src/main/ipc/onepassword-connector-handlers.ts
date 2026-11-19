import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  decodeHostOnePasswordConnectorStatus,
  type OnePasswordConnectInput,
  type OnePasswordHostConnectInput,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import {
  ONEPASSWORD_CONNECTOR_CAPABILITY,
  ONEPASSWORD_CONNECTOR_ROUTES,
} from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { OnePasswordConnectorService } from "../onepassword-connector-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { isObject, requireString, stringPayload } from "./validation";

const MAX_TOKEN_LENGTH = 4096;

export interface OnePasswordConnectorIpcDependencies {
  onePasswordConnector: Pick<
    OnePasswordConnectorService,
    "status" | "checkSetup" | "installCli" | "openApp" | "connect" | "connectWithToken" | "cancel" | "disconnect"
  >;
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

function decodeConnectInput(value: unknown): OnePasswordConnectInput {
  if (!isObject(value)) throw new Error("Invalid 1Password connect input.");
  return {
    accountId: value.accountId === null ? null : requireString(value.accountId, "accountId", INPUT_LIMITS.identifier),
  };
}

function decodeHostConnectInput(value: unknown): OnePasswordHostConnectInput {
  if (!isObject(value)) throw new Error("Invalid 1Password connect input.");
  const token = requireString(value.token, "token", MAX_TOKEN_LENGTH);
  registerSecretValue(token.trim());
  return { token };
}

export function onePasswordConnectorIpcHandlers({
  onePasswordConnector,
  remoteServers,
}: OnePasswordConnectorIpcDependencies): Pick<IpcGroupHandlers, "onePasswordConnector"> {
  function post(serverId: string, path: string, body: OnePasswordHostConnectInput | Record<string, never> = {}) {
    if (!remoteServers.supportsCapability(serverId, ONEPASSWORD_CONNECTOR_CAPABILITY))
      throw new Error(sourceText("error.team.connectorsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeHostOnePasswordConnectorStatus, { method: "POST", body }),
    );
  }

  return {
    onePasswordConnector: {
      status: handler(() => onePasswordConnector.status()),
      checkSetup: handler(() => runCauseEffect(onePasswordConnector.checkSetup())),
      installCli: handler(() => runCauseEffect(onePasswordConnector.installCli())),
      openApp: handler(() => runCauseEffect(onePasswordConnector.openApp())),
      connect: payloadHandler(decodeConnectInput, (input) => runCauseEffect(onePasswordConnector.connect(input))),
      connectWithToken: payloadHandler(stringPayload("token", MAX_TOKEN_LENGTH), (token) =>
        runCauseEffect(onePasswordConnector.connectWithToken(token)),
      ),
      cancel: handler(() => onePasswordConnector.cancel()),
      disconnect: handler(() => runCauseEffect(onePasswordConnector.disconnect())),
      hostStatus: scopedQueryHandler({
        local: () => onePasswordConnector.status(),
        remote: (serverId) => post(serverId, ONEPASSWORD_CONNECTOR_ROUTES.status),
      }),
      hostConnectWithToken: scopedHandler(decodeHostConnectInput, {
        local: ({ token }) => runCauseEffect(onePasswordConnector.connectWithToken(token)),
        remote: ({ token }, serverId) => post(serverId, ONEPASSWORD_CONNECTOR_ROUTES.connect, { token: token.trim() }),
      }),
      hostDisconnect: scopedQueryHandler({
        local: () => runCauseEffect(onePasswordConnector.disconnect()),
        remote: (serverId) => post(serverId, ONEPASSWORD_CONNECTOR_ROUTES.disconnect),
      }),
    },
  };
}
