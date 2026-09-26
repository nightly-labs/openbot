import { createOpenBotPluginUrl, pluginLinkText } from "@openbot/contracts/plugin-links";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { EXTERNAL_LINK_REL } from "../../lib/landing-links";
import {
  PLUGIN_INDEX_ROUTE,
  pluginCategoryLabel,
  pluginExternalHref,
  pluginPath,
  pluginSkills,
  type SitePlugin,
} from "../../lib/plugins";
import { ArticleGradient } from "../content/ArticleGradient";
import { ContentHeader } from "../content/ContentHeader";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon, type LandingIconName } from "../landing/LandingIcon";
import { PluginIcon } from "./PluginIcon";
import { PluginLogo } from "./PluginLogo";
import { PluginOpenButtons } from "./PluginOpenButtons";

/**
 * A counted heading over the rows it names, which is the shape the desktop app's plugin detail
 * uses. The count is part of the heading's text rather than a mark beside it: "Apps" and "Apps 2"
 * are different amounts of information, and a reader who hears the page rather than sees it is
 * owed the same number.
 */
function PluginSection(props: { id: string; title: string; count: number; children: JSX.Element }) {
  return (
    <section class="plugin-section" aria-labelledby={props.id}>
      <h2 class="plugin-section-title" id={props.id}>
        {props.title}
        <span class="plugin-section-count">{props.count}</span>
      </h2>
      {props.children}
    </section>
  );
}

/**
 * One row of a listed thing: its icon, its name, and one line about it. The icon is the listing's
 * own, served from this origin by `src/server/plugin-icon.ts`; the glyph stands in for a thing the
 * catalog gives no icon, which is every skill and any app that has not published one.
 */
function PluginRow(props: { icon: LandingIconName; title: string; description: string; media?: JSX.Element }) {
  return (
    <li class="plugin-row">
      <span class="plugin-row-icon">{props.media ?? <LandingIcon name={props.icon} />}</span>
      <div class="plugin-row-text">
        <h3 class="plugin-row-title">{props.title}</h3>
        <p class="plugin-row-copy">{props.description}</p>
      </div>
    </li>
  );
}

export interface PluginPageProps {
  plugin: SitePlugin;
}

/**
 * One listing, as a reader sees it.
 *
 * Built from the article page's parts rather than its own: the column, the back link, the title and
 * the standfirst are /news and /guides', and the artwork under them is the picture the card a reader
 * pressed already opened on. That is the whole reason the page is laid out in this order - copy,
 * artwork, then the text that answers what the artwork made them curious about - and it is why the
 * three blocks carry the article's three entry steps.
 *
 * Two things the app shows are deliberately absent, as `docs/plugin-distribution.md` asks: the
 * install count, and the MCP server address. The address is the load-bearing one - printing it here
 * would teach a reader to add the server by hand and skip the checks the app makes on the way in.
 */
export function PluginPage(props: PluginPageProps) {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, pluginPath(props.plugin.slug)));

  const skills = () => pluginSkills(props.plugin);

  const links = () =>
    [
      { label: "Website", href: pluginExternalHref(props.plugin.websiteUrl) },
      { label: "Privacy policy", href: pluginExternalHref(props.plugin.privacyPolicyUrl) },
      { label: "Terms", href: pluginExternalHref(props.plugin.termsUrl) },
    ].flatMap((link) => (link.href ? [{ label: link.label, href: link.href }] : []));

  return (
    <div class="landing-page post-article">
      <ContentHeader />

      <main class="post-main">
        <article class="post-container post-article-body">
          <header class="post-article-header" data-enter="post-copy">
            <Link class="post-article-back" to={PLUGIN_INDEX_ROUTE}>
              All plugins
            </Link>
            {/* The name of the listing and the only thing on the page a reader acts on, on one
                line: the button is opposite the title rather than further down, so it is found at
                the moment the title answers what this page is. */}
            <div class="plugin-hero-row">
              <div class="plugin-hero-heading">
                {/* The mark as an icon, in the square a reader looks for when they are about to
                    install something, and the listing's own icon wherever the catalog holds one:
                    that is the picture the app's Plugins tab shows, already drawn as a square. A
                    listing without one falls back to the gradient this page's artwork carries, with
                    the drawn mark on it, so the tile is never empty. */}
                <div class="plugin-hero-mark">
                  <PluginIcon
                    slug={props.plugin.slug}
                    class="plugin-hero-mark-icon"
                    fallback={
                      <>
                        <ArticleGradient title={props.plugin.name} mode="live" />
                        <PluginLogo slug={props.plugin.slug} name={props.plugin.name} class="plugin-hero-mark-logo" />
                      </>
                    }
                  />
                </div>
                <div class="plugin-hero-text">
                  <h1 class="post-article-title">{props.plugin.name}</h1>
                  <p class="post-article-standfirst plugin-hero-standfirst">{props.plugin.tagline}</p>
                </div>
              </div>
              <PluginOpenButtons
                href={createOpenBotPluginUrl(props.plugin.slug)}
                label="Open in OpenBot"
                downloadCopy={`${props.plugin.name} installs from inside OpenBot. Get the app, then open this plugin from its Plugins tab.`}
              />
            </div>
          </header>

          {/* The colours are hashed from the name, so this is the picture the reader's card carried.
              No `art`, because the build bakes a still for an article and a plugin has none; the
              component draws its CSS approximation and the shader takes over on mount. */}
          <div class="post-article-art" data-enter="post-art">
            <ArticleGradient title={props.plugin.name} mode="live" />
            <PluginLogo slug={props.plugin.slug} name={props.plugin.name} class="plugin-hero-logo" />
          </div>

          <div class="plugin-body" data-enter="post-prose">
            <p class="plugin-description">{props.plugin.description}</p>

            <Show when={props.plugin.prompts.length > 0}>
              <PluginSection id="plugin-prompts-title" title="Example prompts" count={props.plugin.prompts.length}>
                {/* The app puts its prompts on the plugin's own artwork, and that artwork is
                    already on this page: the same colour returns behind the requests. Text, and
                    nothing more - the site cannot run a prompt, so nothing here is a button. */}
                <div class="plugin-prompts-card">
                  <ArticleGradient title={props.plugin.name} mode="live" />
                  <ul class="plugin-prompts">
                    <For each={props.plugin.prompts}>
                      {(prompt) => (
                        <li class="plugin-prompt">
                          <span class="plugin-prompt-chip">
                            <PluginIcon
                              slug={props.plugin.slug}
                              class="plugin-prompt-icon"
                              fallback={
                                <PluginLogo
                                  slug={props.plugin.slug}
                                  name={props.plugin.name}
                                  class="plugin-prompt-mark"
                                />
                              }
                            />
                            {props.plugin.name}
                          </span>
                          <span class="plugin-prompt-text">{prompt.text}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </PluginSection>
            </Show>

            <Show when={props.plugin.apps.length > 0}>
              <PluginSection id="plugin-apps-title" title="Apps" count={props.plugin.apps.length}>
                <ul class="plugin-rows">
                  <For each={props.plugin.apps}>
                    {(app) => (
                      <PluginRow
                        icon="puzzle"
                        title={app.name}
                        description={app.description}
                        media={
                          <PluginIcon
                            slug={props.plugin.slug}
                            appId={app.id}
                            fallback={<LandingIcon name="puzzle" />}
                          />
                        }
                      />
                    )}
                  </For>
                </ul>
              </PluginSection>
            </Show>

            <Show when={skills().length > 0}>
              <PluginSection id="plugin-skills-title" title="Skills" count={skills().length}>
                <ul class="plugin-rows">
                  <For each={skills()}>
                    {(skill) => <PluginRow icon="blocks" title={skill.slug} description={skill.description} />}
                  </For>
                </ul>
              </PluginSection>
            </Show>

            {/* Three rows the catalog always carries, and one for each link it holds. */}
            <PluginSection id="plugin-information-title" title="Information" count={3 + links().length}>
              <dl class="plugin-facts">
                <div class="plugin-fact">
                  <dt>Developer</dt>
                  <dd>{props.plugin.creatorName}</dd>
                </div>
                <div class="plugin-fact">
                  <dt>Category</dt>
                  <dd>{pluginCategoryLabel(props.plugin.category)}</dd>
                </div>
                <div class="plugin-fact">
                  <dt>Version</dt>
                  <dd>{props.plugin.version}</dd>
                </div>
                <For each={links()}>
                  {(link) => (
                    <div class="plugin-fact">
                      <dt>{link.label}</dt>
                      <dd>
                        <a class="plugin-fact-link" href={link.href} target="_blank" rel={EXTERNAL_LINK_REL}>
                          {pluginLinkText(link.href)}
                        </a>
                      </dd>
                    </div>
                  )}
                </For>
              </dl>
            </PluginSection>
          </div>
        </article>
      </main>

      <LandingFooter />
    </div>
  );
}
