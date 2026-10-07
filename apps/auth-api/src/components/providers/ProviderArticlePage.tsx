import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { OPENBOT_PLANS, type OpenBotPlan } from "../../content/compare/comparison";
import { OPENBOT_ADDS, type ProviderPage } from "../../content/providers/provider-page";
import { COMPARE_COLLECTION } from "../../lib/compare";
import {
  type CollectionArticle,
  type ContentCollection,
  findArticle,
  formatArticleDate,
} from "../../lib/content-collection";
import { DOWNLOAD_PLATFORM_ORDER, DOWNLOAD_PLATFORMS } from "../../lib/download-platforms";
import { CheckedMeta, CompareFaq, CompareSources, PlanCard, RevealSection } from "../compare/CompareParts";
import { ArticleGradient } from "../content/ArticleGradient";
import { DataArticleFrame } from "../content/DataArticleFrame";
import { LandingIcon } from "../landing/LandingIcon";
import { ProviderMarks } from "./ProviderMarks";

export interface ProviderArticlePageProps {
  collection: ContentCollection<"providers">;
  article: CollectionArticle;
  page: ProviderPage;
}

// What OpenBot does with one provider: how to set it up, what OpenBot adds, the
// provider's own apps for a fair picture, and the other plans an agent can use.
export function ProviderArticlePage(props: ProviderArticlePageProps) {
  const isThisProvider = (plan: OpenBotPlan) => plan.provider === props.page.provider;
  // This provider's plan first, then the rest in their usual order.
  const plans = () => [
    ...OPENBOT_PLANS.filter(isThisProvider),
    ...OPENBOT_PLANS.filter((plan) => !isThisProvider(plan)),
  ];
  const adds = () => [...props.page.adds, ...OPENBOT_ADDS];
  const comparisons = () =>
    props.page.comparisons.flatMap((slug) => {
      const article = findArticle(COMPARE_COLLECTION, slug);
      return article ? [article] : [];
    });

  return (
    <DataArticleFrame collection={props.collection} article={props.article}>
      <header class="compare-hero">
        <div class="compare-hero-copy" data-enter="post-copy">
          <Link class="post-article-back" to={props.collection.indexRoute}>
            {props.collection.backLabel}
          </Link>
          <p class="compare-eyebrow">Provider</p>
          <h1 class="compare-title">{props.article.title}</h1>
          <p class="compare-standfirst">{props.page.answer}</p>
          <CheckedMeta checkedAt={props.page.checkedAt} />
        </div>

        <div class="compare-stage" aria-hidden="true">
          <ArticleGradient
            title={props.article.title}
            art={{ collection: props.collection, slug: props.article.slug, shape: "featured" }}
            mode="live"
            class="compare-stage-art"
          />
          <ProviderMarks page={props.page} />
        </div>
      </header>

      <RevealSection class="provider-setup" titleId="provider-setup-title" title="How to set it up">
        <ol class="provider-steps">
          <li class="provider-step">
            <h3 class="provider-step-title">Download OpenBot</h3>
            <p class="provider-step-text">
              For macOS 13 or later on Apple silicon or Intel, Windows 10 or later on x64, or x64 or arm64 Linux.
            </p>
            <p class="provider-step-links">
              <For each={DOWNLOAD_PLATFORM_ORDER}>
                {(platform) => (
                  <Link to="/download/$platform" params={{ platform }}>
                    {DOWNLOAD_PLATFORMS[platform].label}
                    <LandingIcon name="arrow-right" class="provider-step-arrow" />
                  </Link>
                )}
              </For>
            </p>
          </li>
          <li class="provider-step">
            <h3 class="provider-step-title">Connect {props.page.name}</h3>
            <p class="provider-step-text">
              <WithCode text={props.page.connect} />
            </p>
          </li>
          <li class="provider-step">
            <h3 class="provider-step-title">Give your agent a job</h3>
            <p class="provider-step-text">
              Create an agent on {props.page.name}, choose its model, and give it a task. OpenBot makes a workspace
              folder for it. When the work grows, add agents on other providers to the same channel.
            </p>
          </li>
        </ol>
      </RevealSection>

      <RevealSection class="provider-adds" titleId="provider-adds-title" title="What OpenBot adds">
        <ul class="provider-adds-grid">
          <For each={adds()}>
            {(add, index) => (
              <li class="provider-add" style={{ "--compare-index": index() }}>
                <LandingIcon name={add.icon} class="provider-add-icon" />
                <h3 class="provider-add-title">{add.title}</h3>
                <p class="provider-add-text">{add.text}</p>
              </li>
            )}
          </For>
        </ul>
      </RevealSection>

      <RevealSection class="provider-official" titleId="provider-official-title" title="Official apps">
        <p class="compare-plans-lead">
          The apps from {props.page.vendor}, and where they run. OpenBot runs the same agent, so you can use both.
        </p>
        <div class="compare-table-frame">
          <table class="compare-table provider-table">
            <caption class="landing-visually-hidden">
              Apps from {props.page.vendor}, as checked on {formatArticleDate(props.page.checkedAt)}
            </caption>
            <thead>
              <tr>
                <th scope="col">App</th>
                <th scope="col">Runs on</th>
                <th scope="col">What it is</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.page.officialApps}>
                {(app, index) => (
                  <tr style={{ "--compare-index": index() }}>
                    <th scope="row">{app.name}</th>
                    <td>{app.platforms}</td>
                    <td>
                      <WithCode text={app.note} />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </RevealSection>

      <RevealSection class="compare-plans" titleId="compare-plans-title" title="Every plan an agent can use">
        <p class="compare-plans-lead">
          {props.page.name} is one of them. Choose a provider for each agent, and change it later: the agent keeps its
          role, workspace and conversation.
        </p>
        <ul class="compare-plans-grid">
          <For each={plans()}>
            {(plan, index) => <PlanCard plan={plan} index={index()} highlighted={isThisProvider(plan)} />}
          </For>
        </ul>
      </RevealSection>

      <Show when={comparisons().length > 0}>
        <RevealSection class="provider-related" titleId="provider-related-title" title="Comparisons">
          <ul class="provider-related-list">
            <For each={comparisons()}>
              {(article) => (
                <li>
                  <Link to={COMPARE_COLLECTION.articleRoute} params={{ slug: article.slug }}>
                    {article.title}
                    <LandingIcon name="arrow-right" class="provider-step-arrow provider-related-arrow" />
                  </Link>
                </li>
              )}
            </For>
          </ul>
        </RevealSection>
      </Show>

      <CompareFaq faq={props.page.faq} />

      <CompareSources subject={props.page.name} page={props.page} />
    </DataArticleFrame>
  );
}

/** The text with each part in backticks set as code, such as a command or a variable. */
function WithCode(props: { text: string }) {
  const parts = () => props.text.split("`").map((text, index) => ({ text, code: index % 2 === 1 }));
  return <For each={parts()}>{(part) => (part.code ? <code>{part.text}</code> : part.text)}</For>;
}
