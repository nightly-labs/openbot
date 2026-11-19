import { resolveMobileFeatures, resolveMobileLatestVersion } from "@openbot/contracts/mobile-features";
import { createFileRoute } from "@tanstack/solid-router";
import { APP_MINIMUM_VERSIONS } from "../../../server/app-minimum-version";
import { MOBILE_FEATURE_CONFIG, MOBILE_LATEST_VERSIONS } from "../../../server/mobile-features-config";
import { json } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/mobile/features")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams;
        const platform = query.get("platform");
        return json({
          features: resolveMobileFeatures(MOBILE_FEATURE_CONFIG, platform, query.get("version")),
          latestVersion: resolveMobileLatestVersion(MOBILE_LATEST_VERSIONS, platform),
          minimumVersion: platform === "ios" || platform === "android" ? APP_MINIMUM_VERSIONS[platform] : null,
        });
      },
    },
  },
});
