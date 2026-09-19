import { createFileRoute } from "@tanstack/solid-router";
import { PluginsIndexPage } from "../../components/plugins/PluginsIndexPage";
import { pluginsIndexHead } from "../../lib/content-metadata";

export const Route = createFileRoute("/plugins/")({
  head: ({ match }) => pluginsIndexHead(match.context.siteUrl),
  component: PluginsIndexRoute,
});

function PluginsIndexRoute() {
  return <PluginsIndexPage />;
}
