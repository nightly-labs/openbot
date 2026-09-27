import { AppLogo, ProviderLogo } from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { createTrackedEffect, For, Show } from "solid-js";
import {
  type Comparison,
  type ComparisonSide,
  comparisonScore,
  OPENBOT_PLANS,
  type OpenBotPlan,
} from "../../content/compare/comparison";
import { type ArticleReference, landingAnalytics } from "../../lib/analytics";
import {
  type CollectionArticle,
  type ContentCollection,
  formatArticleDate,
  reportedArticlePath,
} from "../../lib/content-collection";
import { EXTERNAL_LINK_REL } from "../../lib/landing-links";
import { ArticleGradient } from "../content/ArticleGradient";
import { ContentCallToAction } from "../content/ContentCallToAction";
import { createArticleReadDepth } from "../content/createArticleReadDepth";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import { RivalMark, type RivalMarkName } from "./RivalMark";

export interface ComparisonPageProps {
  collection: ContentCollection<"compare">;
  article: CollectionArticle;
  comparison: Comparison;
}

// A comparison is read as a set of answers, not as an essay, so it is drawn from
// data instead of prose: the two marks side by side, the short answer, a table of
// the differences, the differences in depth, the questions people ask, and the
// sources. The table is a real table, so a crawler or an assistant that reads the
// page gets the same rows a reader sees. Where one side is better, the page says so
// in words as well as with a mark, and the summary over the table counts it.
export function ComparisonPage(props: ComparisonPageProps) {
  let articleBody: HTMLElement | undefined;
  const rival = () => props.comparison.rival;
  const score = () => comparisonScore(props.comparison);
  const topics = () => props.comparison.rows.length;
  const tracked = (): ArticleReference => ({ collection: props.collection.id, slug: props.article.slug });

  // Tracked for the same reason as on the article page: a link between two
  // comparisons keeps this route and only changes the parameter.
  createTrackedEffect(() => {
    const article = tracked();
    return landingAnalytics.start(
      document,
      window.location.hostname,
      reportedArticlePath(props.collection, article.slug),
    );
  });

  createArticleReadDepth(
    () => articleBody,
    tracked,
    (article, depth) => landingAnalytics.trackArticleRead(article, depth),
  );

  return (
    <div class="landing-page post-article compare-page">
      <SiteHeader page="content" />

      <main class="post-main">
        <article ref={articleBody} class="post-container compare-article">
          <header class="compare-hero">
            <div class="compare-hero-copy" data-enter="post-copy">
              <Link class="post-article-back" to={props.collection.indexRoute}>
                {props.collection.backLabel}
              </Link>
              <p class="compare-eyebrow">Comparison</p>
              <h1 class="compare-title">
                <UnbrokenName text={props.article.title} name={rival().name} />
              </h1>
              <p class="compare-standfirst">{props.article.description}</p>
              <p class="post-meta compare-meta">
                <span>
                  Checked{" "}
                  <time datetime={props.comparison.checkedAt}>{formatArticleDate(props.comparison.checkedAt)}</time>
                </span>
                <span aria-hidden="true">·</span>
                <a href="#compare-sources">Sources</a>
              </p>
            </div>

            {/* The two marks, over the artwork. Decoration: the title and the table
                already say all of it. The stage itself never fades: see `.compare-stage`. */}
            <div class="compare-stage" aria-hidden="true">
              <ArticleGradient
                title={props.article.title}
                art={{ collection: props.collection, slug: props.article.slug, shape: "featured" }}
                mode="live"
                class="compare-stage-art"
              />
              <div class="compare-marks">
                <span class="compare-mark" data-side="openbot">
                  <AppLogo variant="production" animation="blink" class="compare-mark-logo" />
                  <span class="compare-mark-name">OpenBot</span>
                </span>
                <span class="compare-vs">vs</span>
                <span class="compare-mark" data-side="rival">
                  <RivalMark name={rival().mark} class="compare-mark-logo compare-mark-rival" />
                  <span class="compare-mark-name">{rival().name}</span>
                </span>
              </div>
            </div>
          </header>

          <RevealSection class="compare-answer" titleId="compare-answer-title" title="The short answer">
            <p class="compare-answer-text">{props.comparison.answer}</p>
            <div class="compare-pair">
              <ChoiceCard side="openbot" name="OpenBot" points={props.comparison.chooseOpenBot} recommended />
              <ChoiceCard side="rival" name={rival().name} mark={rival().mark} points={props.comparison.chooseRival} />
            </div>
          </RevealSection>

          {/* The first reason to switch: the plans people already pay for. */}
          <RevealSection class="compare-plans" titleId="compare-plans-title" title="Use the plans you already pay for">
            <p class="compare-plans-lead">
              OpenBot sells you no model. Sign in to the AI plans you already have, or connect your own model, and give
              each agent the one that fits its job.
            </p>
            <ul class="compare-plans-grid">
              <For each={OPENBOT_PLANS}>{(plan, index) => <PlanCard plan={plan} index={index()} />}</For>
            </ul>
            <p class="compare-plans-rival">
              <RivalMark name={rival().mark} class="compare-plans-rival-logo compare-mark-rival" />
              <span>
                <strong>{rival().name}:</strong> {props.comparison.rivalPlans}
              </span>
            </p>
          </RevealSection>

          <RevealSection class="compare-glance" titleId="compare-glance-title" title="At a glance">
            <p class="compare-glance-summary">
              OpenBot is better on {score().openbot} of {topics()} topics, and {rival().name} on {score().rival}.
            </p>
            <div class="compare-table-frame">
              <table class="compare-table">
                <caption class="landing-visually-hidden">
                  OpenBot and {rival().name} compared, as checked on {formatArticleDate(props.comparison.checkedAt)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span class="landing-visually-hidden">Topic</span>
                    </th>
                    <th scope="col" data-side="openbot">
                      <span class="compare-table-brand">
                        <AppLogo variant="production" class="compare-table-logo" />
                        OpenBot
                      </span>
                    </th>
                    <th scope="col" data-side="rival">
                      <span class="compare-table-brand">
                        <RivalMark name={rival().mark} class="compare-table-logo compare-mark-rival" />
                        {rival().name}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.comparison.rows}>
                    {(row, index) => (
                      <tr style={{ "--compare-index": index() }}>
                        <th scope="row">
                          <span class="compare-topic">
                            <LandingIcon name={row.icon} class="compare-topic-icon" />
                            {row.topic}
                          </span>
                        </th>
                        <ValueCell side="openbot" better={row.better} text={row.openbot} />
                        <ValueCell side="rival" better={row.better} text={row.rival} />
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </RevealSection>

          <p class="compare-intro">{props.comparison.intro}</p>

          <For each={props.comparison.sections}>
            {(section, index) => (
              <RevealSection class="compare-depth" titleId={`compare-depth-${index()}`} title={section.title}>
                <div class="compare-pair">
                  <SideCard side="openbot" name="OpenBot" text={section.openbot} better={section.better} />
                  <SideCard
                    side="rival"
                    name={rival().name}
                    mark={rival().mark}
                    text={section.rival}
                    better={section.better}
                  />
                </div>
              </RevealSection>
            )}
          </For>

          <RevealSection class="compare-faq" titleId="compare-faq-title" title="Questions">
            <div class="compare-faq-list">
              <For each={props.comparison.faq}>
                {(entry, index) => (
                  <details class="compare-faq-item" style={{ "--compare-index": index() }}>
                    <summary class="compare-faq-question">
                      {entry.question}
                      <LandingIcon name="chevron-down" class="compare-faq-chevron" />
                    </summary>
                    <p class="compare-faq-answer">{entry.answer}</p>
                  </details>
                )}
              </For>
            </div>
          </RevealSection>

          <RevealSection class="compare-sources" titleId="compare-sources-title" title="Sources" id="compare-sources">
            <p class="compare-sources-note">
              Every statement about {rival().name} comes from the pages below, checked on{" "}
              <time datetime={props.comparison.checkedAt}>{formatArticleDate(props.comparison.checkedAt)}</time>. They
              can change after that date.
            </p>
            <ul class="compare-sources-list">
              <For each={props.comparison.sources}>
                {(source) => (
                  <li>
                    <a href={source.url} target="_blank" rel={EXTERNAL_LINK_REL}>
                      {source.label}
                      <LandingIcon name="arrow-up-right" class="compare-sources-icon" />
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </RevealSection>
        </article>

        <ContentCallToAction />
      </main>

      <LandingFooter />
    </div>
  );
}

/** A section with a heading that comes in as it scrolls into view. */
function RevealSection(props: { class: string; titleId: string; title: string; id?: string; children: JSX.Element }) {
  let section: HTMLElement | undefined;
  const revealed = createLandingReveal(() => section, { rootMargin: "0px 0px -15% 0px" });

  return (
    <section
      ref={section}
      id={props.id}
      class={`compare-section ${props.class}`}
      aria-labelledby={props.titleId}
      data-revealed={revealed() ? "true" : "false"}
    >
      <h2 class="compare-heading" id={props.titleId}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function PlanCard(props: { plan: OpenBotPlan; index: number }) {
  return (
    <li class="compare-plan" style={{ "--compare-index": props.index }}>
      <span class="compare-plan-logo-frame" aria-hidden="true">
        {props.plan.provider === "custom" ? (
          <LandingIcon name="cpu" class="compare-plan-logo compare-plan-logo-custom" />
        ) : (
          <ProviderLogo provider={props.plan.provider} class="compare-plan-logo" />
        )}
      </span>
      <span class="compare-plan-name">{props.plan.name}</span>
      <span class="compare-plan-text">{props.plan.plan}</span>
    </li>
  );
}

/** A value in the table. The better one says so in words, for a reader who does not see the mark. */
function ValueCell(props: { side: ComparisonSide; better?: ComparisonSide; text: string }) {
  const isBetter = () => props.better === props.side;
  return (
    <td data-side={props.side} data-better={isBetter() ? "true" : undefined}>
      <Show when={isBetter()}>
        <span class="compare-better-mark">
          <LandingIcon name="check" class="compare-better-icon" />
          <span class="landing-visually-hidden">Better: </span>
        </span>
      </Show>
      {props.text}
    </td>
  );
}

/** The pill on a card whose side is better on its topic. */
function BetterBadge(props: { label: string }) {
  return (
    <span class="compare-better-badge">
      <LandingIcon name="check" class="compare-better-badge-icon" />
      {props.label}
    </span>
  );
}

interface SideProps {
  side: ComparisonSide;
  name: string;
  /** The rival's mark. OpenBot's own is drawn when this is not given. */
  mark?: RivalMarkName;
}

function SideLabel(props: SideProps) {
  return (
    <span class="compare-side-label">
      {props.mark ? (
        <RivalMark name={props.mark} class="compare-side-logo compare-mark-rival" />
      ) : (
        <AppLogo variant="production" class="compare-side-logo" />
      )}
      {props.name}
    </span>
  );
}

function ChoiceCard(props: SideProps & { points: readonly string[]; recommended?: boolean }) {
  return (
    <div
      class="compare-card compare-choice"
      data-side={props.side}
      data-better={props.recommended ? "true" : undefined}
    >
      <div class="compare-card-head">
        <h3 class="compare-card-title">
          Choose <SideLabel {...props} /> if
        </h3>
        <Show when={props.recommended}>
          <BetterBadge label="Recommended" />
        </Show>
      </div>
      <ul class="compare-choice-list">
        <For each={props.points}>
          {(point) => (
            <li>
              <Show when={props.recommended} fallback={<span class="compare-choice-dot" aria-hidden="true" />}>
                <LandingIcon name="check" class="compare-choice-check" />
              </Show>
              {point}
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

function SideCard(props: SideProps & { text: string; better?: ComparisonSide }) {
  const isBetter = () => props.better === props.side;
  return (
    <div class="compare-card" data-side={props.side} data-better={isBetter() ? "true" : undefined}>
      <div class="compare-card-head">
        <h3 class="compare-card-title">
          <SideLabel {...props} />
        </h3>
        <Show when={isBetter()}>
          <BetterBadge label="Better" />
        </Show>
      </div>
      <p class="compare-card-text">{props.text}</p>
    </div>
  );
}

/** The text with each use of a name held on one line: "Grok" at a line end and "Bot" under it reads as two words. */
function UnbrokenName(props: { text: string; name: string }) {
  const parts = () => props.text.split(props.name);
  return (
    <For each={parts()}>
      {(part, index) => (
        <>
          {index() > 0 && <span class="compare-nowrap">{props.name}</span>}
          {part}
        </>
      )}
    </For>
  );
}
