import { createFileRoute } from "@tanstack/solid-router";
import { latestDownloadResponse } from "../../server/latest-download";

export const Route = createFileRoute("/download/linux")({
  server: {
    handlers: {
      GET: async () => latestDownloadResponse("linux"),
    },
  },
});
