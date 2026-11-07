import { createFileRoute, redirect } from "@tanstack/solid-router";

// The address of the commercial license without the hyphen, as in printed and spoken links.
export const Route = createFileRoute("/commerciallicense")({
  loader: () => {
    throw redirect({ to: "/commercial-license", statusCode: 308 });
  },
});
