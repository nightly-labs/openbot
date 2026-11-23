import { createFileRoute, redirect } from "@tanstack/solid-router";

export const Route = createFileRoute("/branding")({
  loader: () => {
    throw redirect({ to: "/brand", statusCode: 308 });
  },
});
