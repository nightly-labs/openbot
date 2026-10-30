import { createFileRoute, notFound } from "@tanstack/solid-router";
import { PluginPage } from "../../components/plugins/PluginPage";
import { pluginHead } from "../../lib/content-metadata";
import { findPlugin, type SitePlugin } from "../../lib/plugins";

// The same reason the article routes give: the lookup is in `loader`, so a slug the catalog does not
// hold ends as a real not-found response rather than a 200 that draws an error card.
// `loader` and `head` stay in the bundle of every page, so `head` imports the guides when it runs,
// as routes/compare/$slug.tsx does.
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
    // The questions the page shows, as the provider and compare routes add theirs.
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
