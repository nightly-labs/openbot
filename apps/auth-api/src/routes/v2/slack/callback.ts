import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import { requestSlackApp } from "../../../server/request-auth";
import { SlackAppError } from "../../../server/slack-app";

// Slack returns here after the OpenBot app's install. The sealed grant goes to `/slack/connect` in
// the URL fragment, which the browser does not send to any server, and that page opens OpenBot.
export const Route = createFileRoute("/v2/slack/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = new URL("/slack/connect", url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          target.hash = new URLSearchParams({ error: url.searchParams.get("error") ?? "slack_cancelled" }).toString();
          return redirect(target);
        }
        try {
          const slack = requestSlackApp();
          const result = await runApiEffect(
            slack.complete({ code, state, redirectUri: slack.redirectUri(request.url) }),
          );
          // Development only: the dev app's loopback listener takes the grant, not `openbot://`.
          if (result.returnUrl)
            return redirect(
              new URL(`${result.returnUrl}?${new URLSearchParams({ nonce: result.nonce, grant: result.grant })}`),
            );
          target.hash = new URLSearchParams({ nonce: result.nonce, grant: result.grant }).toString();
        } catch (error) {
          target.hash = new URLSearchParams({
            error: error instanceof SlackAppError ? error.code : "slack_exchange_failed",
          }).toString();
        }
        return redirect(target);
      },
    },
  },
});

function redirect(target: URL): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: target.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
