import { createFileRoute } from "@tanstack/solid-router";
import { LandingPage } from "../components/landing/LandingPage";
import { landingHead, loadLandingPage } from "../lib/landing-route";

// The home page in Polish, whatever the language of the request.
export const Route = createFileRoute("/pl")({
  loader: () => loadLandingPage("pl"),
  head: ({ match, loaderData }) => landingHead(match.context.siteUrl, "/pl", loaderData),
  component: PolishHome,
});

function PolishHome() {
  const page = Route.useLoaderData();
  return <LandingPage text={page().text} />;
}
