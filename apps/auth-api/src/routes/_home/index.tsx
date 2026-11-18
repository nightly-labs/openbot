import { createFileRoute } from "@tanstack/solid-router";
import { landingPageText } from "../../lib/landing-page-text";
import { landingHead } from "../../lib/landing-route";
import { loadSitePage, siteLocale } from "../../lib/site-locale";

// The home page in the language of the request: Polish for Polish, Brazilian Portuguese for Portuguese,
// English for all others. `/pl` always shows Polish, and `/pt` Brazilian Portuguese. The language cookie of the header menu comes before the request language.
// The root route sends `Vary: Accept-Language, Cookie`.
export const Route = createFileRoute("/_home/")({
  loader: ({ context }) => loadSitePage(siteLocale(context.locale), landingPageText),
  head: ({ match, loaderData }) => landingHead(match.context.siteUrl, "/", loaderData),
});
