// The Telegram account connection of this computer: start a sign-in, give it each value it asks for,
// cancel it, disconnect, and turn sending on or off. The `host*` endpoints do the same for a joined
// server's connection (`telegram-account-connector-v1`).

import {
  decodeHostTelegramAccountConnectorStatus,
  TELEGRAM_ACCOUNT_API_HASH_PATTERN,
  TELEGRAM_ACCOUNT_SUBMIT_LIMIT,
  type TelegramAccountConnectInput,
  type TelegramAccountSubmitInput,
} from "@openbot/contracts/ipc";
import { isBoolean } from "@openbot/contracts/runtime-values";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import {
  TELEGRAM_ACCOUNT_CONNECTOR_API_HASH_LIMIT,
  TELEGRAM_ACCOUNT_CONNECTOR_CAPABILITY,
  TELEGRAM_ACCOUNT_CONNECTOR_ROUTES,
} from "@openbot/contracts/team-protocol/telegram-account-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { TelegramAccountConnectorService } from "../telegram-account-connector-service";
import { registerSubmittedValue, TELEGRAM_MAX_API_ID } from "../telegram-account-effects";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { isObject, requireString } from "./validation";

// Only the methods these endpoints call, so a test can pass a double without an assertion.
export interface TelegramAccountConnectorIpcDependencies {
  telegramAccountConnector: Pick<
    TelegramAccountConnectorService,
    "status" | "connect" | "submit" | "cancel" | "disconnect" | "setSending"
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

function decodeConnectInput(value: unknown): TelegramAccountConnectInput {
  if (!isObject(value)) throw new Error("Invalid Telegram account connect input.");
  if (value.method !== "qr" && value.method !== "phone") throw new Error("Invalid Telegram account sign-in method.");
  const apiHash =
    value.apiHash === null ? null : requireString(value.apiHash, "apiHash", TELEGRAM_ACCOUNT_CONNECTOR_API_HASH_LIMIT);
  if (apiHash && TELEGRAM_ACCOUNT_API_HASH_PATTERN.test(apiHash)) registerSecretValue(apiHash);
  const apiId = value.apiId;
  if (
    apiId !== null &&
    !(typeof apiId === "number" && Number.isSafeInteger(apiId) && apiId > 0 && apiId <= TELEGRAM_MAX_API_ID)
  )
    throw new Error("Invalid Telegram api_id.");
  return { method: value.method, apiId, apiHash };
}

function decodeSubmitInput(value: unknown): TelegramAccountSubmitInput {
  if (!isObject(value)) throw new Error("Invalid Telegram account sign-in value.");
  const field = value.field;
  if (field !== "phone" && field !== "code" && field !== "password")
    throw new Error("Invalid Telegram account sign-in field.");
  const submitted = requireString(value.value, "value", TELEGRAM_ACCOUNT_SUBMIT_LIMIT);
  registerSubmittedValue({ field, value: submitted });
  return { field, value: submitted };
}

function decodeEnabled(value: unknown): boolean {
  if (!isBoolean(value)) throw new Error("enabled must be a boolean.");
  return value;
}

/**
 * The renderer hands over the API credentials and each sign-in value once. No answer carries them,
 * nor the session: every endpoint answers the status.
 */
export function telegramAccountConnectorIpcHandlers({
  telegramAccountConnector,
  remoteServers,
}: TelegramAccountConnectorIpcDependencies): Pick<IpcGroupHandlers, "telegramAccountConnector"> {
  function post(
    serverId: string,
    path: string,
    body: TelegramAccountConnectInput | TelegramAccountSubmitInput | { enabled: boolean } | Record<string, never> = {},
  ) {
    if (!remoteServers.supportsCapability(serverId, TELEGRAM_ACCOUNT_CONNECTOR_CAPABILITY))
      throw new Error(sourceText("error.team.connectorsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeHostTelegramAccountConnectorStatus, { method: "POST", body }),
    );
  }

  return {
    telegramAccountConnector: {
      status: handler(() => telegramAccountConnector.status()),
      connect: payloadHandler(decodeConnectInput, (input) => runCauseEffect(telegramAccountConnector.connect(input))),
      submit: payloadHandler(decodeSubmitInput, (input) => telegramAccountConnector.submit(input)),
      cancel: handler(() => runCauseEffect(telegramAccountConnector.cancel())),
      disconnect: handler(() => runCauseEffect(telegramAccountConnector.disconnect())),
      setSending: payloadHandler(decodeEnabled, (enabled) =>
        runCauseEffect(telegramAccountConnector.setSending(enabled)),
      ),
      hostStatus: scopedQueryHandler({
        local: () => telegramAccountConnector.status(),
        remote: (serverId) => post(serverId, TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.status),
      }),
      hostConnect: scopedHandler(decodeConnectInput, {
        local: (input) => runCauseEffect(telegramAccountConnector.connect(input)),
        remote: (input, serverId) => post(serverId, TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.connect, input),
      }),
      hostSubmit: scopedHandler(decodeSubmitInput, {
        local: (input) => telegramAccountConnector.submit(input),
        remote: (input, serverId) => post(serverId, TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.submit, input),
      }),
      hostCancel: scopedQueryHandler({
        local: () => runCauseEffect(telegramAccountConnector.cancel()),
        remote: (serverId) => post(serverId, TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.cancel),
      }),
      hostDisconnect: scopedQueryHandler({
        local: () => runCauseEffect(telegramAccountConnector.disconnect()),
        remote: (serverId) => post(serverId, TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.disconnect),
      }),
      hostSetSending: scopedHandler(decodeEnabled, {
        local: (enabled) => runCauseEffect(telegramAccountConnector.setSending(enabled)),
        remote: (enabled, serverId) => post(serverId, TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.setSending, { enabled }),
      }),
    },
  };
}
