import { createFileRoute, notFound } from "@tanstack/solid-router";
import { DownloadPlatformPage } from "../../components/download/DownloadPlatformPage";
import { DOWNLOAD_PAGES, type DownloadPageContent, downloadPageHead } from "../../lib/download-pages";
import { DOWNLOAD_PLATFORM_ORDER } from "../../lib/download-platforms";

// In `loader` for the reason given in routes/news/$slug.tsx: an unknown system is a real not-found
// response, not a 200 with an error card.
function loadDownloadPage(platform: string): DownloadPageContent {
  const known = DOWNLOAD_PLATFORM_ORDER.find((candidate) => candidate === platform);
  if (!known) throw notFound();
  return DOWNLOAD_PAGES[known];
}

export const Route = createFileRoute("/download/$platform")({
  loader: ({ params }) => loadDownloadPage(params.platform),
  head: ({ loaderData, match }) => (loaderData ? downloadPageHead(loaderData.platform, match.context.siteUrl) : {}),
  component: DownloadPlatformRoute,
});

function DownloadPlatformRoute() {
  const page = Route.useLoaderData();
  return <DownloadPlatformPage page={page()} />;
}
