import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../server/effect-runtime";
import { latestDownloadResponse } from "../../server/latest-download";

export const Route = createFileRoute("/download/windows")({
  server: {
    handlers: {
      GET: async () => runApiEffect(latestDownloadResponse("windows")),
    },
  },
});
