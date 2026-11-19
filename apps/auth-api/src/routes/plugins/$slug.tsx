import { createFileRoute, notFound } from "@tanstack/solid-router";
import { PluginPage } from "../../components/plugins/PluginPage";
import { pluginHead } from "../../lib/content-metadata";
import { findPlugin, type SitePlugin } from "../../lib/plugins";

function loadPlugin(slug: string): SitePlugin {
  const plugin = findPlugin(slug);
  if (!plugin) throw notFound();
  return plugin;
}

export const Route = createFileRoute("/plugins/$slug")({
  loader: ({ params }) => loadPlugin(params.slug),
  head: async ({ loaderData, match }) => {
    if (!loaderData) return {};
    const head = pluginHead(loaderData, match.context.siteUrl);
    const [{ findPluginGuide }, { comparisonFaqStructuredData }] = await Promise.all([
      import("../../content/plugins"),
      import("../../content/compare/comparison"),
    ]);
    const guide = findPluginGuide(loaderData.slug);
    if (!guide) return head;
    return { ...head, meta: [...head.meta, { "script:ld+json": comparisonFaqStructuredData(guide) }] };
  },
  component: PluginRoute,
});

function PluginRoute() {
  const plugin = Route.useLoaderData();
  return <PluginPage plugin={plugin()} />;
}
