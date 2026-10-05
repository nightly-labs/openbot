import { resolveMobileFeatures } from "@openbot/contracts/mobile-features";
import { createFileRoute } from "@tanstack/solid-router";
import { MOBILE_FEATURE_CONFIG } from "../../../server/mobile-features-config";
import { json } from "../../../server/request-auth";

/**
 * The mobile feature flags of one platform and app version: `?platform=ios&version=1.2.0`. It needs
 * no session, because the flags depend only on the app version. An unknown platform gets every
 * feature off.
 */
export const Route = createFileRoute("/v1/mobile/features")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams;
        return json({
          features: resolveMobileFeatures(MOBILE_FEATURE_CONFIG, query.get("platform"), query.get("version")),
        });
      },
    },
  },
});
