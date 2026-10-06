import { Link } from "@tanstack/solid-router";
import { For, Match, Show, Switch } from "solid-js";
import { articleGradient, articleGradientCss } from "../../lib/article-gradient";
import { formatArticleDate } from "../../lib/content-collection";
import { PLUGIN_DETAIL_ROUTE } from "../../lib/plugins";
import type {
  ArticleNavigationSection,
  PluginNavigationSection,
  SiteNavigationSection,
} from "../../lib/site-navigation";
import { ArticleGradient } from "../content/ArticleGradient";
import { PluginIcon } from "../plugins/PluginIcon";
import { hasPluginLogo, PluginLogo } from "../plugins/PluginLogo";
import { LandingIcon } from "./LandingIcon";

// The contents of one header section. The desktop menu and the mobile sheet draw
// the same component, and differ only in the frame around it.
//
// The small artwork is the CSS approximation of the article gradient, not the
// shader: a menu can show a dozen of these at once, and a WebGL context each would
// spend the browser's whole budget on a panel that is open for a second. Only the
// featured card moves, and only while the panel is on screen.

export interface SiteNavigationPanelProps {
  section: SiteNavigationSection;
  /**
   * Whether the featured artwork animates. The frame sets this only while the
   * reader can see the panel, because the animation holds a WebGL context and the
   * browser drops the oldest one past a small number.
   */
  live: boolean;
}

export function SiteNavigationPanel(props: SiteNavigationPanelProps) {
  return (
    <div class="site-panel" data-kind={props.section.kind}>
      <Switch>
        <Match when={props.section.kind === "articles" && props.section}>
          {(section) => <ArticlePanelBody section={section()} live={props.live} />}
        </Match>
        <Match when={props.section.kind === "plugins" && props.section}>
          {(section) => <PluginPanelBody section={section()} />}
        </Match>
      </Switch>
      <div class="site-panel-footer">
        <span class="site-panel-summary">{props.section.summary}</span>
        <Link class="site-panel-index" to={props.section.indexRoute}>
          {props.section.indexLabel}
          <LandingIcon name="arrow-right" />
        </Link>
      </div>
    </div>
  );
}

function artwork(title: string): string {
  return articleGradientCss(articleGradient(title));
}

function ArticlePanelBody(props: { section: ArticleNavigationSection; live: boolean }) {
  const featured = () => props.section.articles[0];
  const others = () => props.section.articles.slice(1);

  return (
    <div class="site-panel-body">
      <Show when={featured()}>
        {(article) => (
          <Link
            class="site-panel-feature"
            to={props.section.collection.articleRoute}
            params={{ slug: article().slug }}
            style={{ "--site-panel-art": artwork(article().title) }}
          >
            {/* The shader's host paints the same CSS gradient until its canvas has
                drawn, so the card never shows an empty frame. */}
            <Show when={props.live} fallback={<span class="site-panel-feature-art" aria-hidden="true" />}>
              <ArticleGradient title={article().title} mode="live" class="site-panel-feature-art" />
            </Show>
            <span class="site-panel-feature-badge">Latest</span>
            <span class="site-panel-feature-copy">
              <span class="site-panel-feature-title">{article().title}</span>
              <span class="site-panel-meta">{formatArticleDate(article().publishedAt)}</span>
            </span>
          </Link>
        )}
      </Show>
      <ul class="site-panel-list">
        <For each={others()}>
          {(article) => (
            <li>
              <Link
                class="site-panel-row"
                to={props.section.collection.articleRoute}
                params={{ slug: article.slug }}
                style={{ "--site-panel-art": artwork(article.title) }}
              >
                <span class="site-panel-row-art" aria-hidden="true" />
                <span class="site-panel-row-copy">
                  <span class="site-panel-row-title">{article.title}</span>
                  <span class="site-panel-meta">{formatArticleDate(article.publishedAt)}</span>
                </span>
              </Link>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

function PluginPanelBody(props: { section: PluginNavigationSection }) {
  return (
    <ul class="site-panel-body site-panel-plugins">
      <For each={props.section.plugins}>
        {(plugin) => (
          <li>
            <Link
              class="site-panel-plugin"
              to={PLUGIN_DETAIL_ROUTE}
              params={{ slug: plugin.slug }}
              style={{ "--site-panel-art": artwork(plugin.name) }}
            >
              <span class="site-panel-plugin-mark">
                <Show
                  when={hasPluginLogo(plugin.slug)}
                  fallback={
                    <PluginIcon
                      slug={plugin.slug}
                      class="site-panel-plugin-icon"
                      fallback={<PluginLogo slug={plugin.slug} name={plugin.name} class="site-panel-plugin-logo" />}
                    />
                  }
                >
                  <PluginLogo slug={plugin.slug} name={plugin.name} class="site-panel-plugin-logo" />
                </Show>
              </span>
              <span class="site-panel-row-copy">
                <span class="site-panel-row-title">{plugin.name}</span>
                <span class="site-panel-meta">{plugin.tagline}</span>
              </span>
            </Link>
          </li>
        )}
      </For>
    </ul>
  );
}
