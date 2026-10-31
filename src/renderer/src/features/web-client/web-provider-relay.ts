// The relayed provider sign-ins of the browser client (`sign-in-relay-v1`). The host starts the sign-in
// of its CLI and opens no page. This browser opens the page when the user asks, and the user pastes the
// address that the browser shows at the end: a web page cannot listen for the callback. Only its query
// goes to the host. A device page returns nowhere, so the user only opens it. The sign-in of an account
// after the first starts on its own route (`provider-account-relay-v1` or `-v2`) and then runs as the
// others do.

import {
  type AgentProviderId,
  loopbackCallback,
  type McpSignInRelayPage,
  type ProviderAdminDesktopApi,
  relayCallbackQuery,
} from "@openbot/contracts/ipc";
import type { ProviderAccountRelay } from "@openbot/contracts/team-protocol/provider-account-relays";
import { SIGN_IN_RELAY_PROVIDERS } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { runTeamEffect } from "@openbot/team-client";
import {
  cancelProviderSignInRelay,
  completeSignInRelay,
  signInRelayStatus,
  startProviderAccountSignInRelay,
  startProviderSignInRelay,
  type TeamAdminRequestError,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";

/** How often the host is asked how the sign-in is. */
const POLL_MS = 1_000;

interface RelayedSignIn {
  flowId: string;
  page: McpSignInRelayPage | null;
  url: string | null;
  /** `null` for a page that returns nowhere. */
  state: string | null;
  result: { error: string | null } | null;
  stopped: boolean;
  /** A pasted address went to the host, which completes the sign-in: nothing waits for a paste. */
  accepted: boolean;
}

type RelayApi = Pick<
  ProviderAdminDesktopApi,
  | "startRelaySignIn"
  | "startAccountRelaySignIn"
  | "relaySignInStatus"
  | "openRelaySignIn"
  | "pasteRelaySignIn"
  | "cancelRelaySignIn"
>;

export function webProviderRelay(
  request: (serverId?: string) => TeamApiRequest,
  accountRelay: () => ProviderAccountRelay | null,
): RelayApi {
  const relayed = new Map<string, RelayedSignIn>();
  const keyOf = (provider: AgentProviderId, serverId: string) => `${serverId}\n${provider}`;
  const run = <T>(effect: Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));

  /** Reads the host's status until the sign-in ended, and keeps the page once the host has it. */
  async function follow(entry: RelayedSignIn, send: TeamApiRequest): Promise<void> {
    while (!entry.stopped) {
      const status = await run(signInRelayStatus(send, entry.flowId));
      if (status.result) {
        entry.result = { error: status.result.error ?? null };
        return;
      }
      if (status.authorizeUrl && !entry.url) {
        const error = takePage(entry, status.authorizeUrl);
        if (error) {
          entry.result = { error };
          void run(cancelProviderSignInRelay(send, entry.flowId)).catch(() => undefined);
          return;
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
    }
  }

  /** Starts the flow that `start` opens on the host, in place of any relayed sign-in of `provider`. */
  async function startRelay(
    provider: AgentProviderId,
    serverId: string,
    start: (send: TeamApiRequest) => Effect.Effect<{ flowId: string }, TeamAdminRequestError>,
  ): Promise<void> {
    const key = keyOf(provider, serverId);
    const previous = relayed.get(key);
    if (previous) previous.stopped = true;
    const send = request(serverId);
    const { flowId } = await run(start(send));
    const entry: RelayedSignIn = {
      flowId,
      page: null,
      url: null,
      state: null,
      result: null,
      stopped: false,
      accepted: false,
    };
    relayed.set(key, entry);
    void follow(entry, send).catch((error: unknown) => {
      entry.result = { error: error instanceof Error ? error.message : sourceText("error.mcp.relayEnded") };
    });
  }

  function waiting(provider: AgentProviderId, serverId: string): RelayedSignIn {
    const entry = relayed.get(keyOf(provider, serverId));
    if (!entry?.url || entry.result) throw new Error(sourceText("error.mcp.relayEnded"));
    return entry;
  }

  return {
    startRelaySignIn: (provider, serverId) => {
      const relayProvider = SIGN_IN_RELAY_PROVIDERS.find((candidate) => candidate === provider);
      if (!relayProvider) return Promise.reject(new Error(sourceText("error.team.providersUnsupported")));
      return startRelay(provider, serverId, (send) => startProviderSignInRelay(send, relayProvider));
    },
    startAccountRelaySignIn: ({ provider, accountId }, serverId) => {
      const relay = accountRelay();
      const relayProvider = relay?.providers.find((candidate) => candidate === provider);
      if (!relay || !relayProvider) return Promise.reject(new Error(sourceText("error.team.providersUnsupported")));
      return startRelay(provider, serverId, (send) =>
        startProviderAccountSignInRelay(send, relay, { provider: relayProvider, accountId }),
      );
    },
    relaySignInStatus: async (provider, serverId) => {
      const entry = relayed.get(keyOf(provider, serverId));
      if (!entry) return { page: null, result: { error: sourceText("error.mcp.relayEnded") } };
      return { page: entry.result || entry.accepted ? null : entry.page, result: entry.result };
    },
    // No await comes before `window.open`: a browser blocks a page that the user's click did not open.
    openRelaySignIn: async (provider, serverId) => {
      const entry = waiting(provider, serverId);
      window.open(entry.url ?? "", "_blank", "noopener");
    },
    pasteRelaySignIn: async ({ provider, address }, serverId) => {
      const entry = waiting(provider, serverId);
      if (entry.state === null) throw new Error(sourceText("error.mcp.relayAddressInvalid"));
      const query = relayCallbackQuery(address, entry.state);
      if (query === null) throw new Error(sourceText("error.mcp.relayAddressInvalid"));
      // The host already completes the sign-in: a second grant would change nothing.
      if (entry.accepted) return;
      // The page stays while the host takes the grant, so the form can show why a send failed.
      const status = await run(completeSignInRelay(request(serverId), entry.flowId, query));
      entry.accepted = true;
      if (status.result) entry.result = { error: status.result.error ?? null };
    },
    cancelRelaySignIn: async (provider, serverId) => {
      const key = keyOf(provider, serverId);
      const entry = relayed.get(key);
      if (!entry) throw new Error(sourceText("error.mcp.relayEnded"));
      entry.stopped = true;
      relayed.delete(key);
      return run(cancelProviderSignInRelay(request(serverId), entry.flowId));
    },
  };
}

/**
 * Keeps the page that the host's sign-in opened, or answers why it cannot open here. The host chose
 * it, so only a web page opens, and a page that returns to a loopback address must carry `state`.
 */
function takePage(entry: RelayedSignIn, address: string): string | null {
  const page = URL.parse(address);
  if (page?.protocol !== "https:") return sourceText("error.backend.mcpSignInNotWebPage");
  const state = page.searchParams.get("state");
  const returns = loopbackCallback(page.toString()) !== null;
  if (!state && returns) return sourceText("error.mcp.relayNoState");
  entry.url = page.toString();
  entry.state = state;
  entry.page = { authorizeHost: page.host, listening: false, pasteable: returns || state !== null };
  return null;
}
