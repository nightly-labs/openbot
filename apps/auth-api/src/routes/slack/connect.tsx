import { createFileRoute } from "@tanstack/solid-router";
import { SlackConnectPage } from "../../components/landing/SlackConnectPage";

export const Route = createFileRoute("/slack/connect")({
  head: () => ({
    meta: [
      { title: "Return to OpenBot" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }),
  component: SlackConnectPage,
});
