import { createFileRoute } from "@tanstack/solid-router";
import {
  downloadArchitecture,
  isAvailableDownloadPlatform,
  latestDownloadResponse,
} from "../../../server/latest-download";

// The installer itself. `/download/<platform>` is the page that describes it, and every download
// button on the site links here. `?arch=x64` is the Intel Mac installer and `?arch=arm64` the Linux
// arm64 AppImage.
export const Route = createFileRoute("/download/$platform_/latest")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAvailableDownloadPlatform(params.platform)) return new Response("Not found", { status: 404 });
        const architecture = downloadArchitecture(params.platform, new URL(request.url).searchParams.get("arch"));
        return latestDownloadResponse(params.platform, fetch, architecture);
      },
    },
  },
});
