import type { OnePasswordConnectorStatus } from "@openbot/contracts/ipc";
import {
  ONEPASSWORD_CONNECTOR_CAPABILITY,
  ONEPASSWORD_CONNECTOR_ROUTES,
  ONEPASSWORD_CONNECTOR_TOKEN_LIMIT,
  ONEPASSWORD_CONNECTOR_VAULT_LIMIT,
  ONEPASSWORD_CONNECTOR_VAULT_NAME_LIMIT,
} from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiOnePasswordConnector } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(ONEPASSWORD_CONNECTOR_ROUTES));
const ERROR_LIMIT = 2_000;

function wireStatus(status: OnePasswordConnectorStatus) {
  const connected = status.state === "connected";
  return {
    state: status.state === "choose-account" ? "disconnected" : status.state,
    vaultNames: connected
      ? status.vaultNames
          .slice(0, ONEPASSWORD_CONNECTOR_VAULT_LIMIT)
          .map((name) => name.slice(0, ONEPASSWORD_CONNECTOR_VAULT_NAME_LIMIT))
      : [],
    loginCount: connected ? status.loginCount : null,
    error: status.error?.slice(0, ERROR_LIMIT) ?? null,
  };
}

export async function routeOnePasswordConnector(
  context: TeamApiRequestContext,
  connector: TeamApiOnePasswordConnector | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connector || !capabilities.has(ONEPASSWORD_CONNECTOR_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  switch (url.pathname) {
    case ONEPASSWORD_CONNECTOR_ROUTES.connect:
      return json(
        200,
        wireStatus(
          await runCauseEffect(
            connector.connectWithToken(stringField(body, "token", false, ONEPASSWORD_CONNECTOR_TOKEN_LIMIT)),
          ),
        ),
      );
    case ONEPASSWORD_CONNECTOR_ROUTES.disconnect:
      return json(200, wireStatus(await runCauseEffect(connector.disconnect())));
    default:
      return json(200, wireStatus(await runCauseEffect(connector.refreshLogins())));
  }
}
