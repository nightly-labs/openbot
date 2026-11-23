import { createFileRoute, redirect } from "@tanstack/solid-router";

export const Route = createFileRoute("/commerciallicense")({
  loader: () => {
    throw redirect({ to: "/commercial-license", statusCode: 308 });
  },
});
