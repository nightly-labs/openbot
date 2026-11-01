// The WhatsApp account connection of this computer: start a link, give it the phone number for a
// link with a code, cancel it, unlink, and turn sending on or off. The `host*` endpoints do the same
// for a joined server's connection (`whatsapp-account-connector-v1`).

import {
  decodeHostWhatsAppAccountConnectorStatus,
  WHATSAPP_ACCOUNT_SUBMIT_LIMIT,
  type WhatsAppAccountConnectInput,
  type WhatsAppAccountSubmitInput,
} from "@openbot/contracts/ipc";
import { isBoolean } from "@openbot/contracts/runtime-values";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import {
  WHATSAPP_ACCOUNT_CONNECTOR_CAPABILITY,
  WHATSAPP_ACCOUNT_CONNECTOR_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-account-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { WhatsAppAccountConnectorService } from "../whatsapp-account-connector-service";
import { phoneDigits, registerPhoneNumber } from "../whatsapp-account-effects";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { isObject, requireString } from "./validation";

// Only the methods these endpoints call, so a test can pass a double without an assertion.
export interface WhatsAppAccountConnectorIpcDependencies {
  whatsappAccountConnector: Pick<
    WhatsAppAccountConnectorService,
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

function decodeConnectInput(value: unknown): WhatsAppAccountConnectInput {
  if (!isObject(value)) throw new Error("Invalid WhatsApp account connect input.");
  if (value.method !== "qr" && value.method !== "phone") throw new Error("Invalid WhatsApp account link method.");
  return { method: value.method };
}

function decodeSubmitInput(value: unknown): WhatsAppAccountSubmitInput {
  if (!isObject(value)) throw new Error("Invalid WhatsApp account link value.");
  if (value.field !== "phone") throw new Error("Invalid WhatsApp account link field.");
  const submitted = requireString(value.value, "value", WHATSAPP_ACCOUNT_SUBMIT_LIMIT);
  const digits = phoneDigits(submitted);
  if (digits) registerPhoneNumber(digits);
  return { field: "phone", value: submitted };
}

function decodeEnabled(value: unknown): boolean {
  if (!isBoolean(value)) throw new Error("enabled must be a boolean.");
  return value;
}

/**
 * The renderer hands over the phone number of a link once. No answer carries it nor the keys of the
 * device: every endpoint answers the status.
 */
export function whatsappAccountConnectorIpcHandlers({
  whatsappAccountConnector,
  remoteServers,
}: WhatsAppAccountConnectorIpcDependencies): Pick<IpcGroupHandlers, "whatsappAccountConnector"> {
  function post(
    serverId: string,
    path: string,
    body: WhatsAppAccountConnectInput | WhatsAppAccountSubmitInput | { enabled: boolean } | Record<string, never> = {},
  ) {
    if (!remoteServers.supportsCapability(serverId, WHATSAPP_ACCOUNT_CONNECTOR_CAPABILITY))
      throw new Error(sourceText("error.team.connectorsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeHostWhatsAppAccountConnectorStatus, { method: "POST", body }),
    );
  }

  return {
    whatsappAccountConnector: {
      status: handler(() => whatsappAccountConnector.status()),
      connect: payloadHandler(decodeConnectInput, (input) => runCauseEffect(whatsappAccountConnector.connect(input))),
      submit: payloadHandler(decodeSubmitInput, (input) => runCauseEffect(whatsappAccountConnector.submit(input))),
      cancel: handler(() => whatsappAccountConnector.cancel()),
      disconnect: handler(() => runCauseEffect(whatsappAccountConnector.disconnect())),
      setSending: payloadHandler(decodeEnabled, (enabled) =>
        runCauseEffect(whatsappAccountConnector.setSending(enabled)),
      ),
      hostStatus: scopedQueryHandler({
        local: () => whatsappAccountConnector.status(),
        remote: (serverId) => post(serverId, WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.status),
      }),
      hostConnect: scopedHandler(decodeConnectInput, {
        local: (input) => runCauseEffect(whatsappAccountConnector.connect(input)),
        remote: (input, serverId) => post(serverId, WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.connect, input),
      }),
      hostSubmit: scopedHandler(decodeSubmitInput, {
        local: (input) => runCauseEffect(whatsappAccountConnector.submit(input)),
        remote: (input, serverId) => post(serverId, WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.submit, input),
      }),
      hostCancel: scopedQueryHandler({
        local: () => whatsappAccountConnector.cancel(),
        remote: (serverId) => post(serverId, WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.cancel),
      }),
      hostDisconnect: scopedQueryHandler({
        local: () => runCauseEffect(whatsappAccountConnector.disconnect()),
        remote: (serverId) => post(serverId, WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.disconnect),
      }),
      hostSetSending: scopedHandler(decodeEnabled, {
        local: (enabled) => runCauseEffect(whatsappAccountConnector.setSending(enabled)),
        remote: (enabled, serverId) => post(serverId, WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.setSending, { enabled }),
      }),
    },
  };
}
