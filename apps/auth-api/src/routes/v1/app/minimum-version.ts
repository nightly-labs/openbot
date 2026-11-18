import { isAppSurface } from "@openbot/contracts/app-minimum-version";
import { createFileRoute } from "@tanstack/solid-router";
import { APP_MINIMUM_VERSIONS } from "../../../server/app-minimum-version";

/**
 * The lowest supported version of `?surface=desktop|host|ios|android`, or null. The request has no
 * version, account or session: the app compares its own version. The web client has no minimum.
 */
export const Route = createFileRoute("/v1/app/minimum-version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const surface = new URL(request.url).searchParams.get("surface");
        return Response.json(
          { minimumVersion: isAppSurface(surface) ? APP_MINIMUM_VERSIONS[surface] : null },
          { headers: { "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } },
        );
      },
    },
  },
});
