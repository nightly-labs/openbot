// The relayed sign-ins of the browser client (`sign-in-relay-v1`), for the server settings, the
// marketplace and the sign-in links of the host's agents. The host starts the sign-in and opens no page. This browser cannot listen for the
// callback, so the user opens the page from the dialog and pastes the address that the browser shows
// at the end. Only its query goes to the host.

import {
  hostOnlySignInPage,
  type McpServerConfig,
  type McpSignInRelayPage,
  type McpTestResult,
  relayCallbackQuery,
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

/** How often a sign-in asks the host whether it ended. */
const POLL_MS = 1_000;

/** A relayed sign-in that waits for the address the user pastes. */
interface RelayWait {
  cancel: () => void;
  page: URL;
  view: McpSignInRelayPage;
  state: string | null;
  receive: (query: string) => void;
}

export interface WebMcpRelay {
  /**
   * Runs the sign-in of `config` on the host until it ends. `null` when the page is one that only the
   * host can reach: the relay then ended on the host, and the host's own tab can show the page.
   */
  signIn: (request: TeamApiRequest, config: McpServerConfig) => Promise<McpTestResult | null>;
  /**
   * Runs the sign-in of a link that the agent `agentId` printed until it ends. The host names the page,
   * so any page other than `url` ends the sign-in.
   */
  signInLink: (request: TeamApiRequest, agentId: string, url: string) => Promise<McpTestResult>;
  /** The page of the sign-in of `url`, while it waits in this browser. */
  page: (url: string) => McpSignInRelayPage | null;
  /** Opens the page from a click, so the browser does not block it. */
  open: (url: string) => void;
  /** The address that the browser shows at the end of the sign-in. */
  paste: (url: string, address: string) => Promise<void>;
  /** Ends the sign-in on the host while it waits for an address. */
  cancel: (url: string) => void;
}

/** `onPage` gets each page when it shows, and `null` when its sign-in ends. */
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
    // A new sign-in of the same link can start before this one ends, so this one removes only its own wait.
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
      // The cancel ends before the answer, so it cannot stop a sign-in that starts after it. A failed
      // cancel does not stop the host tab: the flow already ended, or the next start replaces it.
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
      const view = { authorizeHost: page.host, listening: false, pasteable: true };
      const cancel = () => void run(cancelSignInRelay(request, flowId)).catch(() => undefined);
      own = { cancel, page, view, state: page.searchParams.get("state"), receive };
      waits.set(url, own);
      onPage(url, view);
      // The host can end the sign-in first: its deadline passed, or the user cancelled.
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

/** The page address, when it is a web page. The host chose it, so this browser opens nothing else. */
function webPage(address: string): URL | null {
  const url = URL.parse(address);
  return url?.protocol === "https:" ? url : null;
}
