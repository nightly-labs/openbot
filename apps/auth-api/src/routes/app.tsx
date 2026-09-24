import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "OpenBot web" }, { name: "robots", content: "noindex, nofollow" }] }),
  headers: () => ({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
  }),
});
