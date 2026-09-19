import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { PLUGIN_DETAIL_ROUTE, pluginTags, type SitePlugin } from "../../lib/plugins";
import { ArticleGradient } from "../content/ArticleGradient";
import { PluginIcon } from "./PluginIcon";
import { hasPluginLogo, PluginLogo } from "./PluginLogo";

export interface PluginCardProps {
  plugin: SitePlugin;
  /** Position in the grid, used only to stagger the reveal. */
  index: number;
}

/**
 * One listing in the grid, built like an article card: the whole card is the link, the artwork is
 * the largest thing on it, and everything written answers what a reader asks before choosing: the
 * tags under the artwork say what kind of plugin it is and what an install will ask of them, and the
 * two lines under those say who publishes it, which release this is, its name, and what it does.
 *
 * The gradient takes no `art`: the build-time artwork is generated per article, and a plugin has
 * none. Left out, the component draws its CSS approximation and lets the first hover replace it
 * with the shader's own frame, so the card still opens on the picture it animates from.
 */
export function PluginCard(props: PluginCardProps) {
  let root: HTMLAnchorElement | undefined;

  return (
    <Link
      ref={root}
      class="plugin-card"
      to={PLUGIN_DETAIL_ROUTE}
      params={{ slug: props.plugin.slug }}
      style={{ "--plugin-card-index": props.index }}
    >
      <div class="plugin-card-art">
        {/* The name is the only colour input: it hashes to one of the gradient's colour families,
            so two listings never open on the same picture and the catalog carries no colour. */}
        <ArticleGradient title={props.plugin.name} mode="hover" hoverTarget={() => root} />
        {/* The drawn mark where this page holds one, because it is one colour on a gradient that is
            a different colour on every card, and it is our own bytes. For every other listing the
            catalog's icon is fetched through this origin, and a listing with neither keeps the
            letter, so a card is never a bare gradient. */}
        <Show
          when={hasPluginLogo(props.plugin.slug)}
          fallback={
            <PluginIcon
              slug={props.plugin.slug}
              class="plugin-card-icon"
              fallback={<PluginLogo slug={props.plugin.slug} name={props.plugin.name} class="plugin-card-logo" />}
            />
          }
        >
          <PluginLogo slug={props.plugin.slug} name={props.plugin.name} class="plugin-card-logo" />
        </Show>
      </div>
      {/* The same tags the filters over the grid switch on, so a reader can see on a card why it
          survived a selection. They say nothing the two lines below repeat. */}
      <span class="plugin-card-tags">
        <For each={pluginTags(props.plugin)}>{(tag) => <span class="plugin-tag">{tag.label}</span>}</For>
      </span>
      {/* Two lines, each holding what a reader asks first on the left and the detail that answers it
          on the right: who publishes it against which release this is, then the name against what it
          does. No separators, because the gap between the two ends of a line is the separator. */}
      <span class="plugin-card-meta">
        <span class="plugin-card-publisher">{props.plugin.creatorName}</span>
        <span class="plugin-card-version">v{props.plugin.version}</span>
      </span>
      <span class="plugin-card-headline">
        <span class="plugin-card-title">{props.plugin.name}</span>
        <span class="plugin-card-tagline">{props.plugin.tagline}</span>
      </span>
    </Link>
  );
}
