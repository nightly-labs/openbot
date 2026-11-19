import { createFileRoute } from "@tanstack/solid-router";

const LOOPBACK_REDIRECT_URL = "http://127.0.0.1:28417/mcp-auth";

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
