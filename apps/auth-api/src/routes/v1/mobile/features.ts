import { resolveMobileFeatures, resolveMobileLatestVersion } from "@openbot/contracts/mobile-features";
import { createFileRoute } from "@tanstack/solid-router";
import { CHANGELOG_RELEASES } from "../../../lib/changelog-releases";
import { resolveAppMinimumVersion } from "../../../server/app-minimum-version";
import { MOBILE_FEATURE_CONFIG, MOBILE_LATEST_VERSIONS } from "../../../server/mobile-features-config";
import { json } from "../../../server/request-auth";

/**
 * The mobile feature flags of one platform and app version: `?platform=ios&version=1.2.0`, and the
 * newest store version of the platform, and the lowest version that the platform still supports (the
 * same value as `/v1/app/minimum-version`, so a phone needs no second request). It needs no session,
 * because the answer depends only on the platform and the app version. An unknown platform gets every feature off and no versions.
 */
export const Route = createFileRoute("/v1/mobile/features")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams;
        const platform = query.get("platform");
        return json({
          features: resolveMobileFeatures(MOBILE_FEATURE_CONFIG, platform, query.get("version")),
          latestVersion: resolveMobileLatestVersion(MOBILE_LATEST_VERSIONS, platform),
          minimumVersion:
            platform === "ios" || platform === "android"
              ? resolveAppMinimumVersion(CHANGELOG_RELEASES, platform, Date.now())
              : null,
        });
      },
    },
  },
});
