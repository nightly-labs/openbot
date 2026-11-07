import { createFileRoute } from "@tanstack/solid-router";
import { LandingPage } from "../components/landing/LandingPage";
import { landingPageText } from "../lib/landing-page-text";
import { landingHead } from "../lib/landing-route";
import { loadSitePage } from "../lib/site-locale";

// The home page in Brazilian Portuguese, whatever the language of the request.
export const Route = createFileRoute("/pt")({
  loader: () => loadSitePage("pt", landingPageText),
  head: ({ match, loaderData }) => landingHead(match.context.siteUrl, "/pt", loaderData),
  component: PortugueseHome,
});

function PortugueseHome() {
  const page = Route.useLoaderData();
  return <LandingPage text={page().text} />;
}
