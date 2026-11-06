import { createFileRoute } from "@tanstack/solid-router";
import { LandingPage } from "../components/landing/LandingPage";
import { landingHead, loadLandingPage } from "../lib/landing-route";
import { siteLocale } from "../lib/site-locale";

// The home page in the language of the request: Polish for Polish, English for all others. `/pl`
// always shows Polish. The root route sends `Vary: Accept-Language`.
export const Route = createFileRoute("/")({
  loader: ({ context }) => loadLandingPage(siteLocale(context.locale)),
  head: ({ match, loaderData }) => landingHead(match.context.siteUrl, "/", loaderData),
  component: Home,
});

function Home() {
  const page = Route.useLoaderData();
  return <LandingPage text={page().text} />;
}
