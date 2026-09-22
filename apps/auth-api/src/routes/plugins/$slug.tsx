import { createFileRoute, notFound } from "@tanstack/solid-router";
import { PluginPage } from "../../components/plugins/PluginPage";
import { pluginHead } from "../../lib/content-metadata";
import { findPlugin, type SitePlugin } from "../../lib/plugins";

// The same reason the article routes give: the lookup is in `loader`, so a slug the catalog does not
// hold ends as a real not-found response rather than a 200 that draws an error card.
export function loadPlugin(slug: string): SitePlugin {
  const plugin = findPlugin(slug);
  if (!plugin) throw notFound();
  return plugin;
}

export const Route = createFileRoute("/plugins/$slug")({
  loader: ({ params }) => loadPlugin(params.slug),
  head: ({ loaderData, match }) => (loaderData ? pluginHead(loaderData, match.context.siteUrl) : {}),
  component: PluginRoute,
});

function PluginRoute() {
  const plugin = Route.useLoaderData();
  return <PluginPage plugin={plugin()} />;
}
