import {
  hostOnlySignInPage,
  type McpServerConfig,
  type McpSignInRelayPage,
  type McpTestResult,
  relayCallbackQuery,
  relayPageUrl,
  type SignInRelayStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { runTeamEffect } from "@openbot/team-client";
import {
  cancelSignInRelay,
  completeSignInRelay,
  signInRelayStatus,
  startLinkSignInRelay,
  startMcpSignInRelay,
  type TeamAdminRequestError,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";

const POLL_MS = 1_000;

interface RelayWait {
  cancel: () => void;
  page: URL;
  view: McpSignInRelayPage;
  state: string | null;
  receive: (query: string) => void;
}

export interface WebMcpRelay {
  signIn: (request: TeamApiRequest, config: McpServerConfig) => Promise<McpTestResult | null>;
  signInLink: (request: TeamApiRequest, agentId: string, url: string) => Promise<McpTestResult>;
  page: (url: string) => McpSignInRelayPage | null;
  open: (url: string) => void;
  paste: (url: string, address: string) => Promise<void>;
  cancel: (url: string) => void;
}

export function webMcpRelay(
  onPage: (url: string, page: McpSignInRelayPage | null) => void = () => undefined,
): WebMcpRelay {
  const waits = new Map<string, RelayWait>();
  const run = <T>(effect: Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
  const pause = () => new Promise<null>((resolve) => setTimeout(() => resolve(null), POLL_MS));

  async function follow<H>(
    request: TeamApiRequest,
    url: string,
    start: Effect.Effect<{ flowId: string }, TeamAdminRequestError>,
    chosen: string | null,
    hostOnly: H,
  ): Promise<McpTestResult | H> {
    const { flowId } = await run(start);
    const status = () => run(signInRelayStatus(request, flowId));
    let own: RelayWait | null = null;
    const forget = () => {
      if (own !== null && waits.get(url) === own) waits.delete(url);
    };
    try {
      let current: SignInRelayStatus = await status();
      while (!current.result && !current.authorizeUrl) {
        await pause();
        current = await status();
      }
      if (current.result) return current.result;
      if (hostOnlySignInPage(current.authorizeUrl ?? "")) {
        await run(cancelSignInRelay(request, flowId)).catch(() => undefined);
        return hostOnly;
      }
      const page = webPage(current.authorizeUrl ?? "");
      if (!page) return { toolCount: 0, error: sourceText("error.backend.mcpSignInNotWebPage") };
      if (chosen !== null && page.toString() !== chosen) {
        void run(cancelSignInRelay(request, flowId)).catch(() => undefined);
        return { toolCount: 0, error: sourceText("error.team.signInRelayLinkUnknown") };
      }
      let receive: (query: string) => void = () => undefined;
      const pasted = new Promise<string>((resolve) => {
        receive = resolve;
      });
      const view = { authorizeHost: page.host, url: relayPageUrl(page), listening: false, pasteable: true };
      const cancel = () => void run(cancelSignInRelay(request, flowId)).catch(() => undefined);
      own = { cancel, page, view, state: page.searchParams.get("state"), receive };
      waits.set(url, own);
      onPage(url, view);
      while (true) {
        const query = await Promise.race([pasted, pause()]);
        if (query !== null) {
          forget();
          current = await run(completeSignInRelay(request, flowId, query));
          break;
        }
        current = await status();
        if (current.result) return current.result;
      }
      while (!current.result) {
        await pause();
        current = await status();
      }
      return current.result;
    } catch (error) {
      void run(cancelSignInRelay(request, flowId)).catch(() => undefined);
      throw error;
    } finally {
      forget();
      if (!waits.has(url)) onPage(url, null);
    }
  }

  return {
    signIn: (request, config) => follow(request, config.url, startMcpSignInRelay(request, { config }), null, null),
    signInLink: (request, agentId, url) =>
      follow(request, url, startLinkSignInRelay(request, { agentId, url }), url, {
        toolCount: 0,
        error: sourceText("error.backend.mcpSignInNotWebPage"),
      }),
    page: (url) => waits.get(url)?.view ?? null,
    open: (url) => {
      const wait = waits.get(url);
      if (wait) window.open(wait.page, "_blank", "noopener,noreferrer");
    },
    paste: (url, address) => {
      const wait = waits.get(url);
      if (!wait) return Promise.reject(new Error(sourceText("error.mcp.relayEnded")));
      const query = relayCallbackQuery(address, wait.state);
      if (query === null) return Promise.reject(new Error(sourceText("error.mcp.relayAddressInvalid")));
      wait.receive(query);
      return Promise.resolve();
    },
    cancel: (url) => waits.get(url)?.cancel(),
  };
}

function webPage(address: string): URL | null {
  const url = URL.parse(address);
  return url?.protocol === "https:" ? url : null;
}
