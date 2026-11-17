import { isAppSurface } from "@openbot/contracts/app-minimum-version";
import { createFileRoute } from "@tanstack/solid-router";
import { CHANGELOG_RELEASES } from "../../../lib/changelog-releases";
import { resolveAppMinimumVersion } from "../../../server/app-minimum-version";

/**
 * The lowest supported version of one surface: `?surface=desktop`, `host`, `ios` or `android`. The
 * app compares its own version, so the request carries no version, no account and no session. An
 * unknown surface gets no minimum. The web client has none: the Worker serves it, so it is always
 * the current version.
 */
export const Route = createFileRoute("/v1/app/minimum-version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const surface = new URL(request.url).searchParams.get("surface");
        const minimumVersion = isAppSurface(surface)
          ? resolveAppMinimumVersion(CHANGELOG_RELEASES, surface, Date.now())
          : null;
        // The answer changes at most once a day, and every app of a surface asks the same question.
        return Response.json(
          { minimumVersion },
          { headers: { "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } },
        );
      },
    },
  },
});
