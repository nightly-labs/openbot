import { createFileRoute, notFound } from "@tanstack/solid-router";
import { DownloadPlatformPage } from "../../components/download/DownloadPlatformPage";
import type { DownloadPageContent } from "../../lib/download-pages";

async function loadDownloadPage(platform: string): Promise<DownloadPageContent> {
  const { DOWNLOAD_PAGE_ORDER, DOWNLOAD_PAGES } = await import("../../lib/download-pages");
  const known = DOWNLOAD_PAGE_ORDER.find((candidate) => candidate === platform);
  if (!known) throw notFound();
  return DOWNLOAD_PAGES[known];
}

export const Route = createFileRoute("/download/$platform")({
  loader: ({ params }) => loadDownloadPage(params.platform),
  head: async ({ loaderData, match }) => {
    if (!loaderData) return {};
    const { downloadPageHead } = await import("../../lib/download-pages");
    return downloadPageHead(loaderData.platform, match.context.siteUrl);
  },
  component: DownloadPlatformRoute,
});

function DownloadPlatformRoute() {
  const page = Route.useLoaderData();
  return <DownloadPlatformPage page={page()} />;
}
