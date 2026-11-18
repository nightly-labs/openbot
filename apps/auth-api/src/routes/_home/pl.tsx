import { createFileRoute } from "@tanstack/solid-router";
import { landingPageText } from "../../lib/landing-page-text";
import { landingHead } from "../../lib/landing-route";
import { loadSitePage } from "../../lib/site-locale";

// The home page in Polish, whatever the language of the request.
export const Route = createFileRoute("/_home/pl")({
  loader: () => loadSitePage("pl", landingPageText),
  head: ({ match, loaderData }) => landingHead(match.context.siteUrl, "/pl", loaderData),
});
