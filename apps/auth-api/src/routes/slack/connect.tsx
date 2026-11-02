import { createFileRoute } from "@tanstack/solid-router";
import { MessagingConnectPage } from "../../components/transactional/MessagingConnectPage";
import { messagingConnectText } from "../../components/transactional/page-text";
import { loadPageText } from "../../lib/page-text";

export const Route = createFileRoute("/slack/connect")({
  loader: ({ context }) => loadPageText(context.locale, (t) => messagingConnectText(t, "slack")),
  head: ({ loaderData }) => ({
    meta: [
      ...(loaderData ? [{ title: loaderData.text.title }] : []),
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }),
  component: SlackConnect,
});

function SlackConnect() {
  const page = Route.useLoaderData();
  return <MessagingConnectPage provider="slack" lang={page().lang} text={page().text} />;
}
