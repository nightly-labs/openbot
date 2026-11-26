import { createFileRoute } from "@tanstack/solid-router";
import { extensionLinkResponse } from "../server/extension-link";

export const Route = createFileRoute("/chrome-extension")({
  server: { handlers: { GET: ({ request }) => extensionLinkResponse(request) } },
});
