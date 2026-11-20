import { createFileRoute } from "@tanstack/solid-router";
import { landingPageText } from "../../lib/landing-page-text";
import { landingHead } from "../../lib/landing-route";
import { loadSitePage } from "../../lib/site-locale";

export const Route = createFileRoute("/_home/nl")({
  loader: () => loadSitePage("nl", landingPageText),
  head: ({ match, loaderData }) => landingHead(match.context.siteUrl, "/nl", loaderData),
});
