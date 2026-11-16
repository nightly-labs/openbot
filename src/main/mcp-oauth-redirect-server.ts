/**
 * Where an MCP authorization server sends its grant back: a listener on this machine's loopback
 * address, and nothing that leaves it.
 *
 * `openbot://mcp-auth` was the address before this. It is the shorter path - the operating system
 * hands the link straight to the running app - but it is not an address every authorization server
 * accepts. Canva registers a custom scheme without complaint and then refuses it at `/authorize`
 * with `Invalid redirect URI.`, which leaves the user on an error page with nothing to act on. The
 * loopback address is the redirect RFC 8252 tells a native app to use, it is what that server
 * wants, and it is accepted by every other signed-in listing OpenBot ships.
 *
 * So the deep link stays as the fallback for the rare machine where no loopback port can be bound,
 * and for a server whose firewall blocks both loopback names (#7230). This is what a sign-in
 * registers and sends when it is running. The port is
 * `MCP_OAUTH_REDIRECT_PORT` when it is free, so an administrator can register one exact callback
 * for a sign-in app: many authorization servers compare the port, although RFC 8252 says they must
 * not. When another program holds that port, the operating system gives one, and the registration
 * is remade when the stored one names another address.
 *
 * The grant travels no further than this process. The page the browser is left on says only that
 * the window can be closed - the code is in the request line or the posted form, and a page that
 * repeated it would put a credential in the browser's history.
 */

import { MCP_OAUTH_CALLBACK_PATH } from "../backend/mcp-oauth-provider";
import type { LanguageService } from "./language-service";
import { type CallbackAnswer, startLoopbackCallbackServer } from "./loopback-callback-server";

/** The path that a sign-in registers first. */
const MCP_OAUTH_REDIRECT_PATH = "/mcp-auth";

/**
 * The paths this listener answers. Everything else is a 404, including `/`. A server that refuses
 * `/mcp-auth` gets the `/callback` form (`MCP_OAUTH_CALLBACK_PATH`).
 */
export const MCP_OAUTH_REDIRECT_PATHS = [MCP_OAUTH_REDIRECT_PATH, MCP_OAUTH_CALLBACK_PATH] as const;

/** The port tried first. Not assigned by IANA as far as this was checked; any other works the same. */
export const MCP_OAUTH_REDIRECT_PORT = 28_417;

export interface McpOAuthRedirectServer {
  /** The address to register and to send. Stable for as long as this process runs. */
  readonly redirectUrl: string;
  close: () => Promise<void>;
}

export interface McpOAuthRedirectServerOptions {
  /**
   * Hands the grant to the sign-in that is waiting for this `state`, and answers whether one was.
   * A `state` this run did not start is what a forged or replayed request looks like, and it is
   * refused here exactly as the deep link refuses it. `query` is the whole query of the callback,
   * for a sign-in that this computer relays to a joined server on the same port; such a sign-in
   * answers `"relayed"`, because it ends on the host and not here.
   */
  deliver: (state: string, code: string, query: string) => boolean | "relayed";
  /** Hands a refusal to a sign-in that this computer relays, which ends on the host. */
  relayRefusal: (state: string, query: string) => void;
  /** Read on each request, so the page uses the language that is set at that time. */
  language: Pick<LanguageService, "locale" | "translate">;
  /** Tried first; any free port is used when it cannot be bound. */
  preferredPort?: number;
}

/**
 * Binds the listener, or fails.
 *
 * A failure is the caller's to handle rather than this module's: the sign-in still has the deep
 * link to fall back to, and a redirect address that silently became a different one is worse than
 * a named failure.
 */
export async function startMcpOAuthRedirectServer({
  deliver,
  relayRefusal,
  language,
  preferredPort,
}: McpOAuthRedirectServerOptions): Promise<McpOAuthRedirectServer> {
  const server = await startLoopbackCallbackServer({
    paths: MCP_OAUTH_REDIRECT_PATHS,
    receive: (url) => receiveGrant(url, deliver, relayRefusal),
    language,
    port: { preferred: preferredPort },
    noPort: () => new Error("The MCP sign-in listener was given no port."),
  });
  return {
    redirectUrl: `http://127.0.0.1:${server.port}${MCP_OAUTH_REDIRECT_PATH}`,
    close: server.close,
  };
}

/** What a callback that passed the shared checks gets back. Every refusal below is one `return`. */
function receiveGrant(
  url: URL,
  deliver: McpOAuthRedirectServerOptions["deliver"],
  relayRefusal: McpOAuthRedirectServerOptions["relayRefusal"],
): CallbackAnswer {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // An authorization server states a refusal here instead of sending a code. A local sign-in ends on
  // its own deadline, with the words the dialog already has; a relayed one ends on the host at once.
  // This page exists so the person reading the browser is not left on a blank one.
  if (url.searchParams.get("error")) {
    if (state) relayRefusal(state, url.search.slice(1));
    return { status: 400, message: "error.mcp.redirectRefused" };
  }

  if (!code || !state) return { status: 400, message: "error.mcp.redirectNotSignIn" };
  const delivered = deliver(state, code, url.search.slice(1));
  if (!delivered) return { status: 400, message: "error.mcp.redirectNoSignIn" };
  return { status: 200, message: delivered === "relayed" ? "error.mcp.redirectRelayed" : "error.mcp.redirectSignedIn" };
}
