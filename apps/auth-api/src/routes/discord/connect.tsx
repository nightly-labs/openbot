import { createFileRoute } from "@tanstack/solid-router";
import { DiscordConnectPage } from "../../components/landing/DiscordConnectPage";

export const Route = createFileRoute("/discord/connect")({
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
  component: DiscordConnectPage,
});
