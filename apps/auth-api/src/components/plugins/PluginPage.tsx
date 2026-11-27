import { createOpenBotPluginUrl, createWebAppPluginPath, pluginLinkText } from "@openbot/contracts/plugin-links";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { For, onSettled, Show } from "solid-js";
import { findPluginGuide } from "../../content/plugins";
import { landingAnalytics } from "../../lib/analytics";
import { EXTERNAL_LINK_REL } from "../../lib/landing-links";
import { MARKETPLACE_APPS_ROUTE } from "../../lib/marketplace-routes";
import {
  pluginCategoryLabel,
  pluginConnectSteps,
  pluginExternalHref,
  pluginMcpIntro,
  pluginMcpServers,
  pluginPath,
  pluginSkills,
  type SitePlugin,
  type SitePluginConnectStep,
} from "../../lib/plugins";
import { CompareFaq, CompareSources } from "../compare/CompareParts";
import { ArticleGradient } from "../content/ArticleGradient";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon, type LandingIconName } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import { PluginIcon } from "./PluginIcon";
import { PluginLogo } from "./PluginLogo";
import { PluginOpenButtons } from "./PluginOpenButtons";

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

function PluginTextSection(props: { id: string; title: string; children: JSX.Element }) {
  return (
    <section class="plugin-section" aria-labelledby={props.id}>
      <h2 class="plugin-section-title" id={props.id}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function PluginConnectDocsLink(props: { href: string | null; label: string | null }) {
  return (
    <Show when={props.href}>
      {(href) => (
        <p class="provider-step-links">
          <a href={href()} target="_blank" rel={EXTERNAL_LINK_REL}>
            {props.label ?? "Documentation"}
            <LandingIcon name="arrow-up-right" class="provider-step-arrow" />
          </a>
        </p>
      )}
    </Show>
  );
}

function PluginConnectStep(props: { step: SitePluginConnectStep; appCount: number }) {
  const prefix = () => (props.appCount > 1 ? `${props.step.app}: ` : "");
  return (
    <li class="provider-step">
      <Show when={props.step.kind === "link"}>
        <h3 class="provider-step-title">{prefix()}Sign in</h3>
        <p class="provider-step-text">
          Press Connect and finish the sign-in in your browser. OpenBot keeps the token on the computer that runs
          OpenBot. You can disconnect at any time.
        </p>
      </Show>
      <Show when={props.step.kind === "key" ? props.step : undefined}>
        {(step) => (
          <>
            <h3 class="provider-step-title">
              {prefix()}Add your {step().fields.length > 1 ? "details" : step().fields[0]?.label}
            </h3>
            <p class="provider-step-text">
              Press Connect and enter {step().fields.length > 1 ? "these values" : "this value"}. OpenBot keeps{" "}
              {step().fields.length > 1 ? "them" : "it"} on the computer that runs OpenBot.
            </p>
            <ul class="plugin-connect-fields">
              <For each={step().fields}>
                {(field) => (
                  <li>
                    <strong class="plugin-connect-field-label">{field.label}</strong>
                    <Show when={field.optional}> (optional)</Show>
                    <Show when={field.hint}>{(hint) => <> - {hint()}</>}</Show>
                  </li>
                )}
              </For>
            </ul>
            <PluginConnectDocsLink href={step().docsUrl} label={step().docsLabel} />
          </>
        )}
      </Show>
      <Show when={props.step.kind === "local" ? props.step : undefined}>
        {(step) => (
          <>
            <h3 class="provider-step-title">
              {prefix()}Set up the {step().label}
            </h3>
            <p class="provider-step-text">
              The server runs on the computer that runs OpenBot, so it needs the {step().label} first.
            </p>
            <ol class="plugin-connect-fields">
              <For each={step().steps}>{(line) => <li>{line}</li>}</For>
            </ol>
            <Show when={step().note}>{(note) => <p class="provider-step-text">{note()}</p>}</Show>
            <PluginConnectDocsLink href={step().docsUrl} label={step().docsLabel} />
          </>
        )}
      </Show>
    </li>
  );
}

export interface PluginPageProps {
  plugin: SitePlugin;
}

export function PluginPage(props: PluginPageProps) {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, pluginPath(props.plugin.slug)));

  const skills = () => pluginSkills(props.plugin);
  const guide = () => findPluginGuide(props.plugin.slug);
  const connectSteps = () => pluginConnectSteps(props.plugin);

  const links = () =>
    [
      { label: "Website", href: pluginExternalHref(props.plugin.websiteUrl) },
      { label: "Privacy policy", href: pluginExternalHref(props.plugin.privacyPolicyUrl) },
      { label: "Terms", href: pluginExternalHref(props.plugin.termsUrl) },
    ].flatMap((link) => (link.href ? [{ label: link.label, href: link.href }] : []));

  return (
    <div class="landing-page post-article">
      <SiteHeader page="content" />

      <main class="post-main">
        <article class="post-container post-article-body">
          <header class="post-article-header" data-enter="post-copy">
            <Link class="post-article-back" to={MARKETPLACE_APPS_ROUTE}>
              All plugins
            </Link>
            <div class="plugin-hero-row">
              <div class="plugin-hero-heading">
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
                browserHref={createWebAppPluginPath(props.plugin.slug)}
                label="Open in OpenBot"
                downloadCopy={`${props.plugin.name} installs from inside OpenBot. Get the app, then open this plugin from its Apps tab.`}
              />
            </div>
          </header>

          <div class="post-article-art" data-enter="post-art">
            <ArticleGradient title={props.plugin.name} mode="live" />
            <PluginLogo slug={props.plugin.slug} name={props.plugin.name} class="plugin-hero-logo" />
          </div>

          <div class="plugin-body" data-enter="post-prose">
            <p class="plugin-description">{props.plugin.description}</p>

            <Show when={props.plugin.apps.length > 0}>
              <PluginTextSection id="plugin-mcp-title" title={`${props.plugin.name} MCP server`}>
                <p class="plugin-description">{pluginMcpIntro(props.plugin)}</p>
                <ul class="plugin-connect-fields">
                  <For each={pluginMcpServers(props.plugin)}>
                    {(server) => (
                      <li>
                        <strong class="plugin-connect-field-label">{server.app}</strong>: {server.where}{" "}
                        <code class="plugin-mcp-address">{server.address}</code>
                      </li>
                    )}
                  </For>
                </ul>
              </PluginTextSection>
            </Show>

            <Show when={guide()}>
              {(written) => (
                <PluginTextSection id="plugin-uses-title" title={`What an agent can do with ${props.plugin.name}`}>
                  <ul class="provider-adds-grid plugin-uses">
                    <For each={written().uses}>
                      {(use) => (
                        <li class="provider-add">
                          <h3 class="provider-add-title">{use.title}</h3>
                          <p class="provider-add-text">{use.text}</p>
                        </li>
                      )}
                    </For>
                  </ul>
                </PluginTextSection>
              )}
            </Show>

            <PluginTextSection id="plugin-connect-title" title={`How to connect ${props.plugin.name} to OpenBot`}>
              <ol class="provider-steps plugin-connect">
                <li class="provider-step">
                  <h3 class="provider-step-title">Open {props.plugin.name} in OpenBot</h3>
                  <p class="provider-step-text">
                    Press Open in OpenBot on this page, or find {props.plugin.name} in the app's Apps tab. Get the app
                    first if it is not on this computer.
                  </p>
                </li>
                <For each={connectSteps()}>
                  {(step) => <PluginConnectStep step={step} appCount={props.plugin.apps.length} />}
                </For>
                <li class="provider-step">
                  <h3 class="provider-step-title">Give an agent a task</h3>
                  <p class="provider-step-text">
                    {connectSteps().length === 0 ? `OpenBot asks for no sign-in or key for ${props.plugin.name}. ` : ""}
                    Ask an agent for work that needs {props.plugin.name}
                    {props.plugin.prompts.length > 0 ? ", such as one of the example prompts below" : ""}. The agent
                    uses the plugin's tools to do it.
                  </p>
                </li>
              </ol>
            </PluginTextSection>

            <Show when={props.plugin.prompts.length > 0}>
              <PluginSection id="plugin-prompts-title" title="Example prompts" count={props.plugin.prompts.length}>
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

            <Show when={guide()}>
              {(written) => (
                <>
                  <CompareFaq faq={written().faq} />
                  <CompareSources subject={props.plugin.name} page={written()} />
                </>
              )}
            </Show>
          </div>
        </article>
      </main>

      <LandingFooter />
    </div>
  );
}
