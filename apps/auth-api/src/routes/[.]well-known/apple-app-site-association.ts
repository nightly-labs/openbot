import { createFileRoute } from "@tanstack/solid-router";

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appID: "ZTRDTUL87R.app.openbot.desktop",
        paths: ["/join"],
      },
      {
        appID: "ZTRDTUL87R.run.openbot.mobile",
        // The mobile app opens a shared agent's preview; the desktop reads that page in the browser.
        paths: ["/join", "/agents/*"],
      },
    ],
  },
};

export function createAppleAppSiteAssociationResponse(): Response {
  return new Response(JSON.stringify(APPLE_APP_SITE_ASSOCIATION), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: createAppleAppSiteAssociationResponse,
    },
  },
});
