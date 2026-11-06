import { createFileRoute } from "@tanstack/solid-router";
import { LandingPage } from "../components/landing/LandingPage";
import { landingPageText } from "../lib/landing-page-text";
import { landingHead } from "../lib/landing-route";
import { loadSitePage, siteLocale } from "../lib/site-locale";

// The home page in the language of the request: Polish for Polish, English for all others. `/pl`
// always shows Polish. The language cookie of the header menu comes before the request language.
// The root route sends `Vary: Accept-Language, Cookie`.
export const Route = createFileRoute("/")({
  loader: ({ context }) => loadSitePage(siteLocale(context.locale), landingPageText),
  head: ({ match, loaderData }) => landingHead(match.context.siteUrl, "/", loaderData),
  component: Home,
});

function Home() {
  const page = Route.useLoaderData();
  return <LandingPage text={page().text} />;
}
