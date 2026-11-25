import { xPageRulesHash } from "@openbot/contracts/browser-extension-x";
import { createFileRoute } from "@tanstack/solid-router";
import { X_PAGE_RULES_CURRENT } from "../../../server/browser-extension-x-rules";

const currentHash = xPageRulesHash(X_PAGE_RULES_CURRENT);

export const Route = createFileRoute("/v1/browser-extension/x-rules")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const hash = await currentHash;
        const same = new URL(request.url).searchParams.get("hash") === hash;
        return new Response(JSON.stringify({ hash, rules: same ? null : X_PAGE_RULES_CURRENT }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
        });
      },
    },
  },
});
