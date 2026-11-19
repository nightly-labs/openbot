import { MCP_OAUTH_CALLBACK_PATH } from "../backend/mcp-oauth-provider";
import type { LanguageService } from "./language-service";
import { type CallbackAnswer, startLoopbackCallbackServer } from "./loopback-callback-server";

const MCP_OAUTH_REDIRECT_PATH = "/mcp-auth";

export const MCP_OAUTH_REDIRECT_PATHS = [MCP_OAUTH_REDIRECT_PATH, MCP_OAUTH_CALLBACK_PATH] as const;

export const MCP_OAUTH_REDIRECT_PORT = 28_417;

export interface McpOAuthRedirectServer {
  readonly redirectUrl: string;
  close: () => Promise<void>;
}

export interface McpOAuthRedirectServerOptions {
  deliver: (state: string, code: string, query: string) => boolean | "relayed" | Promise<boolean>;
  relayRefusal: (state: string, query: string) => void;
  language: Pick<LanguageService, "locale" | "translate">;
  preferredPort?: number;
}

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

function receiveGrant(
  url: URL,
  deliver: McpOAuthRedirectServerOptions["deliver"],
  relayRefusal: McpOAuthRedirectServerOptions["relayRefusal"],
): CallbackAnswer | Promise<CallbackAnswer> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) {
    if (state) relayRefusal(state, url.search.slice(1));
    return { status: 400, message: "error.mcp.redirectRefused" };
  }

  if (!code || !state) return { status: 400, message: "error.mcp.redirectNotSignIn" };
  const delivered = deliver(state, code, url.search.slice(1));
  if (delivered instanceof Promise)
    return delivered.then(
      (saved): CallbackAnswer =>
        saved
          ? { status: 200, message: "error.mcp.redirectSignedIn" }
          : { status: 400, message: "error.mcp.redirectNotSaved" },
    );
  if (!delivered) return { status: 400, message: "error.mcp.redirectNoSignIn" };
  return { status: 200, message: delivered === "relayed" ? "error.mcp.redirectRelayed" : "error.mcp.redirectSignedIn" };
}
