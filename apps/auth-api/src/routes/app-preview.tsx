import { createFileRoute } from "@tanstack/solid-router";
import previewStylesheet from "../../../../src/renderer/src/preview/preview.css?url";

export const Route = createFileRoute("/app-preview")({
  head: () => ({
    meta: [{ title: "OpenBot application preview" }, { name: "robots", content: "noindex, follow" }],
    links: [{ rel: "stylesheet", href: previewStylesheet }],
  }),
  headers: () => ({ "X-Robots-Tag": "noindex, follow" }),
});
