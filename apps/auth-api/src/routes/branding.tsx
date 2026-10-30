import { createFileRoute, redirect } from "@tanstack/solid-router";

// The Commercial License Agreement names openbot.run/branding for the brand guidelines.
export const Route = createFileRoute("/branding")({
  loader: () => {
    throw redirect({ to: "/brand", statusCode: 308 });
  },
});
