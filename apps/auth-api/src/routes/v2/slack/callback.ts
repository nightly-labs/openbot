import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { installReturnPage } from "../../../server/canonical-redirect";
import { runApiResponse } from "../../../server/effect-runtime";
import { requestSlackApp } from "../../../server/request-auth";
import { SlackAppError } from "../../../server/slack-app";

export const Route = createFileRoute("/v2/slack/callback")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        const target = installReturnPage("/slack/connect", url);
        return runApiResponse(
          Effect.gen(function* () {
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            if (!code || !state) {
              target.hash = new URLSearchParams({
                error: url.searchParams.get("error") ?? "slack_cancelled",
              }).toString();
              return redirect(target);
            }
            const slack = requestSlackApp();
            const result = yield* slack.complete({ code, state, redirectUri: slack.redirectUri(request.url) });
            if (result.returnUrl)
              return redirect(
                new URL(`${result.returnUrl}?${new URLSearchParams({ nonce: result.nonce, grant: result.grant })}`),
              );
            target.hash = new URLSearchParams({ nonce: result.nonce, grant: result.grant }).toString();
            return redirect(target);
          }),
          (error) => {
            target.hash = new URLSearchParams({
              error: error instanceof SlackAppError ? error.code : "slack_exchange_failed",
            }).toString();
            return redirect(target);
          },
        );
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
