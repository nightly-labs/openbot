import { createFileRoute } from "@tanstack/solid-router";
import previewStylesheet from "../../../../src/renderer/src/preview/preview.css?url";

// The demo takes the app stylesheet as a link, not as a CSS import. In dev, the server style link
// of each page collects the CSS imports that the root route reaches, and the root route reaches
// the whole route tree through `@tanstack/solid-start/server`. An import put the app's
// `html, body { overflow: hidden }` on every page, and the landing page did not scroll. The
// collector skips `?url` imports.
export const Route = createFileRoute("/app-preview")({
  head: () => ({
    meta: [{ title: "OpenBot application preview" }, { name: "robots", content: "noindex, follow" }],
    links: [{ rel: "stylesheet", href: previewStylesheet }],
  }),
  headers: () => ({ "X-Robots-Tag": "noindex, follow" }),
});
