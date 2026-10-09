import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "OpenBot web" }, { name: "robots", content: "noindex, nofollow" }] }),
  headers: () => ({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    // A visual reply page runs in a sandboxed `srcdoc` frame, which inherits this policy. A
    // `script-src` or `default-src` here would stop the page and its bootstrap script.
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
  }),
});
