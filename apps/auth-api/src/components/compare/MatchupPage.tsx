import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import {
  comparisonScore,
  type MatchupComparison,
  OPENBOT_PLANS,
  type OpenBotPlan,
} from "../../content/compare/comparison";
import { PROVIDER_PAGES, providerPageSlug } from "../../content/providers";
import { type CollectionArticle, type ContentCollection, formatArticleDate } from "../../lib/content-collection";
import { ArticleGradient } from "../content/ArticleGradient";
import { DataArticleFrame } from "../content/DataArticleFrame";
import { LandingIcon } from "../landing/LandingIcon";
import { CompareBenchmark } from "./CompareBenchmark";
import {
  CheckedMeta,
  ChoiceCard,
  CompareFaq,
  CompareMarks,
  CompareSources,
  PlanCard,
  RevealSection,
  SideCard,
  SideMark,
  type SideProps,
  UnbrokenName,
  ValueCell,
} from "./CompareParts";

export interface MatchupPageProps {
  collection: ContentCollection<"compare">;
  article: CollectionArticle;
  matchup: MatchupComparison;
}

// Two products that OpenBot runs, against each other. The page is neutral: neither
// side is recommended and neither column is lit. After the table come the benchmark
// numbers, when there are any, and then one section says what the page is for: you
// do not have to choose, because OpenBot runs both.
export function MatchupPage(props: MatchupPageProps) {
  const sideA = (): SideProps => ({ side: "a", ...props.matchup.products[0] });
  const sideB = (): SideProps => ({ side: "b", ...props.matchup.products[1] });
  const names = () => props.matchup.products.map((product) => product.name);
  const score = () => comparisonScore(props.matchup.rows, ["a", "b"]);
  const topics = () => props.matchup.rows.length;
  const isCompared = (plan: OpenBotPlan) =>
    props.matchup.products.some((product) => product.provider === plan.provider);
  // The plans of the two products first, then the rest in their usual order.
  const plans = () => [...OPENBOT_PLANS.filter(isCompared), ...OPENBOT_PLANS.filter((plan) => !isCompared(plan))];
  // The provider page of each product, which says how to set it up in OpenBot. The link uses the
  // page's name, which is the provider's name in OpenBot: Antigravity runs as Gemini.
  const setups = () =>
    props.matchup.products.flatMap((product) => {
      const slug = providerPageSlug(product.provider);
      const page = slug ? PROVIDER_PAGES[slug] : undefined;
      return slug && page ? [{ name: page.name, slug }] : [];
    });

  return (
    <DataArticleFrame collection={props.collection} article={props.article}>
      <header class="compare-hero">
        <div class="compare-hero-copy" data-enter="post-copy">
          <Link class="post-article-back" to={props.collection.indexRoute}>
            {props.collection.backLabel}
          </Link>
          <p class="compare-eyebrow">Comparison</p>
          <h1 class="compare-title">
            <UnbrokenName text={props.article.title} names={names()} />
          </h1>
          <p class="compare-standfirst">{props.article.description}</p>
          <CheckedMeta checkedAt={props.matchup.checkedAt} />
        </div>

        <div class="compare-stage" aria-hidden="true">
          <ArticleGradient
            title={props.article.title}
            art={{ collection: props.collection, slug: props.article.slug, shape: "featured" }}
            mode="live"
            class="compare-stage-art"
          />
          <CompareMarks sides={[sideA(), sideB()]} />
        </div>
      </header>

      <RevealSection class="compare-answer" titleId="compare-answer-title" title="The short answer">
        <p class="compare-answer-text">{props.matchup.answer}</p>
        <div class="compare-pair">
          <ChoiceCard {...sideA()} points={props.matchup.chooseA} />
          <ChoiceCard {...sideB()} points={props.matchup.chooseB} />
        </div>
      </RevealSection>

      <RevealSection class="compare-glance" titleId="compare-glance-title" title="At a glance">
        <p class="compare-glance-summary">
          {sideA().name} wins {score()[0]} of {topics()} topics, and {sideB().name} wins {score()[1]}.
          <Show when={score()[0] + score()[1] < topics()}> The rest are a draw.</Show>
        </p>
        <div class="compare-table-frame">
          <table class="compare-table">
            <caption class="landing-visually-hidden">
              {sideA().name} and {sideB().name} compared, as checked on {formatArticleDate(props.matchup.checkedAt)}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span class="landing-visually-hidden">Topic</span>
                </th>
                <For each={[sideA(), sideB()]}>
                  {(side) => (
                    <th scope="col" data-side={side.side}>
                      <span class="compare-table-brand">
                        <SideMark mark={side.mark} class="compare-table-logo" />
                        {side.name}
                      </span>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={props.matchup.rows}>
                {(row, index) => (
                  <tr style={{ "--compare-index": index() }}>
                    <th scope="row">
                      <span class="compare-topic">
                        <LandingIcon name={row.icon} class="compare-topic-icon" />
                        {row.topic}
                      </span>
                    </th>
                    <ValueCell side="a" better={row.better} text={row.a} />
                    <ValueCell side="b" better={row.better} text={row.b} />
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </RevealSection>

      <Show when={props.matchup.benchmark}>{(benchmark) => <CompareBenchmark benchmark={benchmark()} />}</Show>

      <RevealSection class="compare-plans" titleId="compare-plans-title" title="You don't have to pick one">
        <p class="compare-plans-lead">{props.matchup.bothInOpenBot}</p>
        <ul class="compare-plans-grid">
          <For each={plans()}>
            {(plan, index) => <PlanCard plan={plan} index={index()} highlighted={isCompared(plan)} />}
          </For>
        </ul>
        <Show when={setups().length > 0}>
          <ul class="provider-related-list">
            <For each={setups()}>
              {(setup) => (
                <li>
                  <Link to="/providers/$slug" params={{ slug: setup.slug }}>
                    Set up {setup.name} in OpenBot
                    <LandingIcon name="arrow-right" class="provider-step-arrow provider-related-arrow" />
                  </Link>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </RevealSection>

      <p class="compare-intro">{props.matchup.intro}</p>

      <For each={props.matchup.sections}>
        {(section, index) => (
          <RevealSection class="compare-depth" titleId={`compare-depth-${index()}`} title={section.title}>
            <div class="compare-pair">
              <SideCard {...sideA()} text={section.a} better={section.better} />
              <SideCard {...sideB()} text={section.b} better={section.better} />
            </div>
          </RevealSection>
        )}
      </For>

      <CompareFaq faq={props.matchup.faq} />

      <CompareSources subject={`${sideA().name} and ${sideB().name}`} page={props.matchup} />
    </DataArticleFrame>
  );
}
