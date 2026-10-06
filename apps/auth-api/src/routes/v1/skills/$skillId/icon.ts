import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { requestSkillMarketplace, skillErrorResponse } from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/$skillId/icon")({
  server: {
    handlers: {
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const object = yield* requestSkillMarketplace().icon(params.skillId);
            return object
              ? new Response(object.body, {
                  headers: {
                    "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
                    "Cache-Control": "public, max-age=300",
                    ETag: object.httpEtag,
                  },
                })
              : new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
          }),
          skillErrorResponse,
        ),
    },
  },
});
