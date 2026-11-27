import { createFileRoute } from "@tanstack/solid-router";
import { landingPageText } from "../../lib/landing-page-text";
import { landingHead } from "../../lib/landing-route";
import { loadSitePage, siteLocale } from "../../lib/site-locale";

export const Route = createFileRoute("/_home/")({
  loader: ({ context }) => loadSitePage(siteLocale(context.locale), landingPageText),
  head: ({ match, loaderData }) => landingHead(match.context.siteUrl, "/", loaderData),
});
