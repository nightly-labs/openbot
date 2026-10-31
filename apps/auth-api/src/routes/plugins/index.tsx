import { createFileRoute, redirect } from "@tanstack/solid-router";

/** The plugins are the Marketplace's Apps tab now. Old links and search results move there for good. */
export const Route = createFileRoute("/plugins/")({
  loader: () => {
    throw redirect({ to: "/marketplace/apps", statusCode: 301 });
  },
});
