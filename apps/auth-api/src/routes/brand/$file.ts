import { createFileRoute } from "@tanstack/solid-router";
import { brandAssetResponse } from "../../server/brand-asset";

export const Route = createFileRoute("/brand/$file")({
  server: { handlers: { GET: ({ params }) => brandAssetResponse(params.file) } },
});
