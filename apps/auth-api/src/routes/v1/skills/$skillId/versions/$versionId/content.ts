import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../../server/effect-runtime";
import { requestSkillMarketplace, skillErrorResponse } from "../../../../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/$skillId/versions/$versionId/content")({
  server: {
    handlers: {
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const object = yield* requestSkillMarketplace().versionContent(params.skillId, params.versionId);
            const headers = new Headers({
              "Cache-Control": "public, max-age=31536000, immutable",
              "Content-Type": "application/zip",
              "X-Content-Type-Options": "nosniff",
            });
            headers.set("ETag", object.httpEtag);
            return new Response(object.body, { headers });
          }),
          skillErrorResponse,
        ),
    },
  },
});
