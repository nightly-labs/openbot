import { PROVIDER_ACCOUNT_RELAYS } from "@openbot/contracts/team-protocol/provider-account-relays";
import {
  PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY,
  PROVIDER_SIGN_IN_RELAY_V2_PROVIDERS,
  PROVIDER_SIGN_IN_RELAY_V2_ROUTES,
} from "@openbot/contracts/team-protocol/provider-sign-in-relay-v2";
import {
  SIGN_IN_RELAY_DEEP_LINK_CAPABILITY,
  SIGN_IN_RELAY_DEEP_LINK_ROUTES,
} from "@openbot/contracts/team-protocol/sign-in-relay-deep-link-v1";
import {
  SIGN_IN_RELAY_CAPABILITY,
  SIGN_IN_RELAY_PROVIDERS,
  SIGN_IN_RELAY_ROUTES,
} from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { devinSignInPageRelayed } from "../../backend/acp-sign-in";
import { runCauseEffect } from "../../backend/effect-boundary";
import { MCP_OAUTH_REDIRECT_URL } from "../deep-link-router";
import { parseTestMcpServer } from "../ipc/mcp-inputs";
import type {
  TeamApiMcpServerOwners,
  TeamApiMcpServers,
  TeamApiProviderAccounts,
  TeamApiSignInRelay,
} from "./dependencies";
import { HttpError } from "./http-error";
import { requireMcpAccess, requireOwnMcpAddress } from "./mcp-member-access";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { nullableString, readJson, requireAdmin, stringField } from "./request-helpers";
import { requireRoomForAccount } from "./route-provider-accounts";

const ROUTES: ReadonlySet<string> = new Set([
  ...Object.values(SIGN_IN_RELAY_ROUTES),
  ...Object.values(SIGN_IN_RELAY_DEEP_LINK_ROUTES),
]);

export async function routeSignInRelay(
  context: TeamApiRequestContext,
  relay: TeamApiSignInRelay | undefined,
  mcpServers?: Pick<TeamApiMcpServers, "listMcpServers">,
  owners?: TeamApiMcpServerOwners,
  providerAccounts?: Pick<TeamApiProviderAccounts, "list">,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, sessionId, request, json } = context;
  const accountStart =
    method === "POST" ? PROVIDER_ACCOUNT_RELAYS.find((candidate) => candidate.start === url.pathname) : undefined;
  if (accountStart) {
    if (!relay || !capabilities.has(accountStart.capability))
      throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
    requireAdmin(member);
    const body = await readJson(request);
    const provider = accountStart.providers.find((id) => id === stringField(body, "provider"));
    if (!provider) throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
    const accountId = nullableString(body, "accountId");
    requireRoomForAccount(capabilities, providerAccounts, provider, accountId);
    return json(200, await runCauseEffect(relay.startProviderAccount(member.id, provider, accountId, sessionId)));
  }
  if (method === "POST" && url.pathname === PROVIDER_SIGN_IN_RELAY_V2_ROUTES.start) {
    if (!relay || !devinSignInPageRelayed() || !capabilities.has(PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
    requireAdmin(member);
    const body = await readJson(request);
    const provider = PROVIDER_SIGN_IN_RELAY_V2_PROVIDERS.find((id) => id === stringField(body, "provider"));
    if (!provider) throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
    return json(200, await runCauseEffect(relay.startProvider(member.id, provider, sessionId)));
  }
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  const deepLink = url.pathname === SIGN_IN_RELAY_DEEP_LINK_ROUTES.mcpStart;
  if (
    !relay ||
    !capabilities.has(SIGN_IN_RELAY_CAPABILITY) ||
    (deepLink && !capabilities.has(SIGN_IN_RELAY_DEEP_LINK_CAPABILITY))
  )
    throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
  const memberRoute =
    deepLink ||
    url.pathname === SIGN_IN_RELAY_ROUTES.mcpStart ||
    url.pathname === SIGN_IN_RELAY_ROUTES.status ||
    url.pathname === SIGN_IN_RELAY_ROUTES.complete ||
    url.pathname === SIGN_IN_RELAY_ROUTES.cancel;
  if (!memberRoute) requireAdmin(member);
  const access = memberRoute ? requireMcpAccess(member, capabilities, owners) : null;
  const body = await readJson(request);
  switch (url.pathname) {
    case SIGN_IN_RELAY_DEEP_LINK_ROUTES.mcpStart:
    case SIGN_IN_RELAY_ROUTES.mcpStart: {
      const input = parseTestMcpServer(body);
      requireOwnMcpAddress(access, mcpServers?.listMcpServers() ?? [], input.config.url);
      return json(
        200,
        await runCauseEffect(relay.startMcp(member.id, input, deepLink ? MCP_OAUTH_REDIRECT_URL : undefined)),
      );
    }
    case SIGN_IN_RELAY_ROUTES.providerStart: {
      const provider = SIGN_IN_RELAY_PROVIDERS.find((id) => id === stringField(body, "provider"));
      if (!provider) throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
      return json(200, await runCauseEffect(relay.startProvider(member.id, provider, sessionId)));
    }
    case SIGN_IN_RELAY_ROUTES.linkStart:
      return json(
        200,
        relay.startLink(member.id, stringField(body, "agentId"), stringField(body, "url", false, 8_192)),
      );
    case SIGN_IN_RELAY_ROUTES.status:
      return json(200, relay.status(member.id, stringField(body, "flowId")));
    case SIGN_IN_RELAY_ROUTES.complete:
      return json(
        200,
        await runCauseEffect(
          relay.complete(member.id, stringField(body, "flowId"), stringField(body, "query", true, 8_192)),
        ),
      );
    default:
      await runCauseEffect(relay.cancel(member.id, stringField(body, "flowId")));
      return json(200, {});
  }
}
