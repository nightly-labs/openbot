import { createFileRoute } from "@tanstack/solid-router";
import { brandAssetResponse } from "../../server/brand-asset";

/** `/brand/<file>.svg`: one logo file of the /brand page, so a saved image keeps its name. */
export const Route = createFileRoute("/brand/$file")({
  server: { handlers: { GET: ({ params }) => brandAssetResponse(params.file) } },
});
