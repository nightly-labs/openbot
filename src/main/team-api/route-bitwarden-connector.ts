import type { BitwardenConnectorStatus } from "@openbot/contracts/ipc";
import {
  BITWARDEN_CONNECTOR_CAPABILITY,
  BITWARDEN_CONNECTOR_KEY_LIMIT,
  BITWARDEN_CONNECTOR_PASSWORD_LIMIT,
  BITWARDEN_CONNECTOR_ROUTES,
  BITWARDEN_CONNECTOR_URL_LIMIT,
} from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiBitwardenConnector } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(BITWARDEN_CONNECTOR_ROUTES));
const ERROR_LIMIT = 2_000;

function wireStatus(status: BitwardenConnectorStatus) {
  return {
    state: status.connecting ? "connecting" : status.connected ? "connected" : "disconnected",
    serverUrl: status.serverUrl?.slice(0, BITWARDEN_CONNECTOR_URL_LIMIT) ?? null,
    error: status.error?.slice(0, ERROR_LIMIT) ?? null,
  };
}

export async function routeBitwardenConnector(
  context: TeamApiRequestContext,
  connector: TeamApiBitwardenConnector | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connector || !capabilities.has(BITWARDEN_CONNECTOR_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  switch (url.pathname) {
    case BITWARDEN_CONNECTOR_ROUTES.connect: {
      const input = {
        serverUrl: stringField(body, "serverUrl", false, BITWARDEN_CONNECTOR_URL_LIMIT),
        clientId: stringField(body, "clientId", false, BITWARDEN_CONNECTOR_KEY_LIMIT),
        clientSecret: stringField(body, "clientSecret", false, BITWARDEN_CONNECTOR_KEY_LIMIT),
        masterPassword: stringField(body, "masterPassword", false, BITWARDEN_CONNECTOR_PASSWORD_LIMIT),
      };
      return json(200, wireStatus(await runCauseEffect(connector.connectWithApiKey(input))));
    }
    case BITWARDEN_CONNECTOR_ROUTES.disconnect:
      return json(200, wireStatus(await runCauseEffect(connector.disconnect())));
    default:
      return json(200, wireStatus(connector.status()));
  }
}
