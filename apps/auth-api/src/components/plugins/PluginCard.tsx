import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { PLUGIN_DETAIL_ROUTE, pluginTags, type SitePlugin } from "../../lib/plugins";
import { ArticleGradient } from "../content/ArticleGradient";
import { PluginIcon } from "./PluginIcon";
import { hasPluginLogo, PluginLogo } from "./PluginLogo";

export interface PluginCardProps {
  plugin: SitePlugin;
  index: number;
}

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
        <ArticleGradient title={props.plugin.name} mode="hover" hoverTarget={() => root} />
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
      <span class="plugin-card-tags">
        <For each={pluginTags(props.plugin)}>{(tag) => <span class="plugin-tag">{tag.label}</span>}</For>
      </span>
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
