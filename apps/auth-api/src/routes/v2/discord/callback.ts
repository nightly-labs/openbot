import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { installReturnPage } from "../../../server/canonical-redirect";
import { DiscordAppError } from "../../../server/discord-app";
import { runApiResponse } from "../../../server/effect-runtime";
import { requestDiscordApp } from "../../../server/request-auth";

export const Route = createFileRoute("/v2/discord/callback")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        const target = installReturnPage("/discord/connect", url);
        return runApiResponse(
          Effect.gen(function* () {
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            if (!code || !state) {
              target.hash = new URLSearchParams({
                error: url.searchParams.get("error") ?? "discord_cancelled",
              }).toString();
              return redirect(target);
            }
            const discord = requestDiscordApp();
            const result = yield* discord.complete({ code, state, redirectUri: discord.redirectUri(request.url) });
            target.hash = new URLSearchParams({ nonce: result.nonce, grant: result.grant }).toString();
            return redirect(target);
          }),
          (error) => {
            target.hash = new URLSearchParams({
              error: error instanceof DiscordAppError ? error.code : "discord_exchange_failed",
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
