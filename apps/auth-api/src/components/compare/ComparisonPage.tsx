import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";
import { type Comparison, comparisonScore, OPENBOT_PLANS } from "../../content/compare/comparison";
import { type CollectionArticle, type ContentCollection, formatArticleDate } from "../../lib/content-collection";
import { ArticleGradient } from "../content/ArticleGradient";
import { DataArticleFrame } from "../content/DataArticleFrame";
import { LandingIcon } from "../landing/LandingIcon";
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
import { RivalMark } from "./RivalMark";

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
  const rival = () => props.comparison.rival;
  const openbot: SideProps = { side: "openbot", name: "OpenBot" };
  const rivalSide = (): SideProps => ({ side: "rival", name: rival().name, mark: rival().mark });
  const score = () => comparisonScore(props.comparison.rows, ["openbot", "rival"]);
  const topics = () => props.comparison.rows.length;

  return (
    <DataArticleFrame collection={props.collection} article={props.article}>
      <header class="compare-hero">
        <div class="compare-hero-copy" data-enter="post-copy">
          <Link class="post-article-back" to={props.collection.indexRoute}>
            {props.collection.backLabel}
          </Link>
          <p class="compare-eyebrow">Comparison</p>
          <h1 class="compare-title">
            <UnbrokenName text={props.article.title} names={[rival().name]} />
          </h1>
          <p class="compare-standfirst">{props.article.description}</p>
          <CheckedMeta checkedAt={props.comparison.checkedAt} />
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
          <CompareMarks sides={[openbot, rivalSide()]} />
        </div>
      </header>

      <RevealSection class="compare-answer" titleId="compare-answer-title" title="The short answer">
        <p class="compare-answer-text">{props.comparison.answer}</p>
        <div class="compare-pair">
          <ChoiceCard {...openbot} points={props.comparison.chooseOpenBot} recommended />
          <ChoiceCard {...rivalSide()} points={props.comparison.chooseRival} />
        </div>
      </RevealSection>

      {/* The first reason to switch: the plans people already pay for. */}
      <RevealSection class="compare-plans" titleId="compare-plans-title" title="Use the plans you already pay for">
        <p class="compare-plans-lead">
          OpenBot sells you no model. Sign in to the AI plans you already have, or connect your own model, and give each
          agent the one that fits its job.
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
          OpenBot is better on {score()[0]} of {topics()} topics, and {rival().name} on {score()[1]}.
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
                <For each={[openbot, rivalSide()]}>
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
              <SideCard {...openbot} text={section.openbot} better={section.better} />
              <SideCard {...rivalSide()} text={section.rival} better={section.better} />
            </div>
          </RevealSection>
        )}
      </For>

      <CompareFaq faq={props.comparison.faq} />

      <CompareSources subject={rival().name} page={props.comparison} />
    </DataArticleFrame>
  );
}
