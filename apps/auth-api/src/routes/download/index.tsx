import { createFileRoute } from "@tanstack/solid-router";
import { DownloadHubPage } from "../../components/download/DownloadHubPage";
import { downloadPageHead } from "../../lib/download-pages";

export const Route = createFileRoute("/download/")({
  head: ({ match }) => downloadPageHead("hub", match.context.siteUrl),
  component: DownloadHubPage,
});
