import { createFileRoute, redirect } from "@tanstack/solid-router";

export const Route = createFileRoute("/plugins/")({
  loader: () => {
    throw redirect({ to: "/marketplace/apps", statusCode: 301 });
  },
});
