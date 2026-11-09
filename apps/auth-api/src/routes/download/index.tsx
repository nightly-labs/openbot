import { createFileRoute } from "@tanstack/solid-router";
import { DownloadHubPage } from "../../components/download/DownloadHubPage";
import { LandingTextProvider } from "../../components/landing/LandingText";
import { landingPageText } from "../../lib/landing-page-text";
import { loadPageText } from "../../lib/page-text";

// `head` imports the pages when it runs, as in routes/compare/$slug.tsx.
// The hero download selector reads the home page text. The hub is in English, so the selector is too.
export const Route = createFileRoute("/download/")({
  loader: () => loadPageText("en", landingPageText),
  head: async ({ match }) => {
    const { downloadPageHead } = await import("../../lib/download-pages");
    return downloadPageHead("hub", match.context.siteUrl);
  },
  component: DownloadHub,
});

function DownloadHub() {
  const page = Route.useLoaderData();
  return (
    <LandingTextProvider text={page().text}>
      <DownloadHubPage />
    </LandingTextProvider>
  );
}
