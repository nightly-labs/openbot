import { createFileRoute } from "@tanstack/solid-router";

const APPLE_APP_SITE_ASSOCIATION = {
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
      {
        // The mobile app moves to the Synthetify team. Builds from the old team stay installed until
        // their users update, so both teams keep the same paths.
        appID: "8A47NKRZSJ.run.openbot.mobile",
        paths: ["/join", "/agents/*"],
      },
    ],
  },
};

function createAppleAppSiteAssociationResponse(): Response {
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
