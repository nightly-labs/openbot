import { createFileRoute } from "@tanstack/solid-router";

/**
 * The loopback listener of `src/main/mcp-oauth-redirect-server.ts` on its preferred port
 * (`MCP_OAUTH_REDIRECT_PORT`). The same address is in `mcp-client[.]json.ts`.
 */
const LOOPBACK_REDIRECT_URL = "http://127.0.0.1:28417/mcp-auth";

/**
 * The HTTPS redirect address of an MCP authorization server that refuses every `http` address,
 * loopback too. Meta's ads MCP server (`https://www.facebook.com/ads`) is one: its app settings save
 * no `http` redirect, and its sign-in page refuses `http://127.0.0.1` ("isn't using a secure
 * connection"). `BUILT_IN_MCP_CLIENTS` in `src/backend/mcp-oauth-provider.ts` sends this address.
 *
 * The browser goes on to the loopback listener of the computer it runs on, with the query as it came:
 * `code` and `state`, or the `error` of a refusal. The Worker keeps nothing and shows no page. The
 * code is worth nothing here: PKCE binds it to the verifier that only the OpenBot process that
 * started the sign-in holds. The target is fixed, so this route cannot send a browser anywhere else.
 */
function mcpCallbackResponse({ request }: { request: Request }): Response {
  const { search } = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${LOOPBACK_REDIRECT_URL}${search}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/oauth/mcp-callback")({
  server: { handlers: { GET: mcpCallbackResponse } },
});
