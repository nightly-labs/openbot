import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../server/effect-runtime";
import { latestDownloadResponse } from "../../server/latest-download";

export const Route = createFileRoute("/download/macos")({
  server: {
    handlers: {
      // `?arch=x64` is the Intel installer. Anything else gets Apple silicon, which most Macs run.
      GET: async ({ request }) =>
        runApiEffect(
          latestDownloadResponse(
            "macos",
            fetch,
            new URL(request.url).searchParams.get("arch") === "x64" ? "x64" : "arm64",
          ),
        ),
    },
  },
});
