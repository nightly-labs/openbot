import { PROVIDER_ACCOUNT_RELAYS } from "@openbot/contracts/team-protocol/provider-account-relays";
import {
  SIGN_IN_RELAY_CAPABILITY,
  SIGN_IN_RELAY_PROVIDERS,
  SIGN_IN_RELAY_ROUTES,
} from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseTestMcpServer } from "../ipc/mcp-inputs";
import type { TeamApiMcpServerOwners, TeamApiMcpServers, TeamApiSignInRelay } from "./dependencies";
import { HttpError } from "./http-error";
import { requireMcpAccess, requireOwnMcpAddress } from "./mcp-member-access";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { nullableString, readJson, requireAdmin, stringField } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(SIGN_IN_RELAY_ROUTES));

/**
 * Sign-ins of this host that an administrator finishes in the browser of their own computer. Frozen
 * by `sign-in-relay-v1`, and by `provider-account-relay-v1` and `-v2` for the start of an account's sign-in.
 *
 * `complete` carries the query of the callback, which holds a grant. It travels only on the encrypted
 * Team channel, and `SignInRelayHost` never logs it. `requireAdmin` runs on every route, and a flow
 * answers only the member who started it. With `mcp-member-access-v1`, a member also starts the MCP
 * sign-in of an address that no row of another person uses, and follows the flows they started.
 */
export async function routeSignInRelay(
  context: TeamApiRequestContext,
  relay: TeamApiSignInRelay | undefined,
  mcpServers?: Pick<TeamApiMcpServers, "listMcpServers">,
  owners?: TeamApiMcpServerOwners,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const accountStart =
    method === "POST" ? PROVIDER_ACCOUNT_RELAYS.find((candidate) => candidate.start === url.pathname) : undefined;
  if (accountStart) {
    // The host advertises the capability only with `sign-in-relay-v1` and `provider-accounts-v1`.
    if (!relay || !capabilities.has(accountStart.capability))
      throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
    requireAdmin(member);
    const body = await readJson(request);
    // The codec admits only the providers of the route and a valid account id or null.
    const provider = accountStart.providers.find((id) => id === stringField(body, "provider"));
    if (!provider) throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
    return json(
      200,
      await runCauseEffect(relay.startProviderAccount(member.id, provider, nullableString(body, "accountId"))),
    );
  }
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!relay || !capabilities.has(SIGN_IN_RELAY_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
  // A provider's sign-in and an agent's link stay with owners and admins. A flow answers only the
  // member who started it, so a member reads and ends only an MCP sign-in of their own.
  const memberRoute =
    url.pathname === SIGN_IN_RELAY_ROUTES.mcpStart ||
    url.pathname === SIGN_IN_RELAY_ROUTES.status ||
    url.pathname === SIGN_IN_RELAY_ROUTES.complete ||
    url.pathname === SIGN_IN_RELAY_ROUTES.cancel;
  if (!memberRoute) requireAdmin(member);
  const access = memberRoute ? requireMcpAccess(member, capabilities, owners) : null;
  // `readJson` has already run the body through the `sign-in-relay-v1` codec.
  const body = await readJson(request);
  switch (url.pathname) {
    case SIGN_IN_RELAY_ROUTES.mcpStart: {
      const input = parseTestMcpServer(body);
      requireOwnMcpAddress(access, mcpServers?.listMcpServers() ?? [], input.config.url);
      return json(200, await runCauseEffect(relay.startMcp(member.id, input)));
    }
    case SIGN_IN_RELAY_ROUTES.providerStart: {
      // The codec admits only `SIGN_IN_RELAY_PROVIDERS`.
      const provider = SIGN_IN_RELAY_PROVIDERS.find((id) => id === stringField(body, "provider"));
      if (!provider) throw new HttpError(400, sourceText("error.team.signInRelayUnsupported"));
      return json(200, await runCauseEffect(relay.startProvider(member.id, provider)));
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
