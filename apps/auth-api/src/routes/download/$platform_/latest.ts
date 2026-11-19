import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import {
  androidApkResponse,
  downloadArchitecture,
  isAvailableDownloadPlatform,
  latestDownloadResponse,
} from "../../../server/latest-download";

export const Route = createFileRoute("/download/$platform_/latest")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (params.platform === "android") return androidApkResponse();
        if (!isAvailableDownloadPlatform(params.platform)) return new Response("Not found", { status: 404 });
        const architecture = downloadArchitecture(params.platform, new URL(request.url).searchParams.get("arch"));
        return runApiEffect(latestDownloadResponse(params.platform, fetch, architecture));
      },
    },
  },
});
