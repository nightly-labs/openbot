import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { type RoundupApp, type RoundupComparison, roundupAppAnchor } from "../../content/compare/comparison";
import {
  type CollectionArticle,
  type ContentCollection,
  findArticle,
  formatArticleDate,
} from "../../lib/content-collection";
import { ArticleGradient } from "../content/ArticleGradient";
import { DataArticleFrame } from "../content/DataArticleFrame";
import { LandingIcon } from "../landing/LandingIcon";
import { CompareBenchmark } from "./CompareBenchmark";
import { CheckedMeta, CompareFaq, CompareMarkRow, CompareSources, RevealSection, SideLabel } from "./CompareParts";

export interface RoundupPageProps {
  collection: ContentCollection<"compare">;
  article: CollectionArticle;
  roundup: RoundupComparison;
}

/** OpenBot's entry draws its own logo, which `SideMark` draws when no mark is given. */
function appMark(app: RoundupApp) {
  return app.mark === "openbot" ? undefined : app.mark;
}

// Many apps in one list. OpenBot is first, and the page says that we make it. Each
// other entry links to the comparisons that include it, where its sources are. The
// summary table is a real table, for the same reason as on a comparison.
export function RoundupPage(props: RoundupPageProps) {
  return (
    <DataArticleFrame collection={props.collection} article={props.article}>
      <header class="compare-hero">
        <div class="compare-hero-copy" data-enter="post-copy">
          <Link class="post-article-back" to={props.collection.indexRoute}>
            {props.collection.backLabel}
          </Link>
          <p class="compare-eyebrow">Roundup</p>
          <h1 class="compare-title">{props.article.title}</h1>
          <p class="compare-standfirst">{props.article.description}</p>
          <CheckedMeta checkedAt={props.roundup.checkedAt} />
        </div>

        <div class="compare-stage" aria-hidden="true">
          <ArticleGradient
            title={props.article.title}
            art={{ collection: props.collection, slug: props.article.slug, shape: "featured" }}
            mode="live"
            class="compare-stage-art"
          />
          <CompareMarkRow apps={props.roundup.apps} />
        </div>
      </header>

      <RevealSection class="compare-answer" titleId="compare-answer-title" title="The short answer">
        <p class="compare-answer-text">{props.roundup.answer}</p>
        <p class="compare-roundup-disclosure">
          We make OpenBot, so it's first on the list. Every other entry links to a comparison with its sources.
        </p>
      </RevealSection>

      <RevealSection class="compare-glance" titleId="compare-glance-title" title="At a glance">
        <div class="compare-table-frame">
          <table class="compare-table compare-roundup-table">
            <caption class="landing-visually-hidden">
              AI agent apps compared, as checked on {formatArticleDate(props.roundup.checkedAt)}
            </caption>
            <thead>
              <tr>
                <th scope="col">App</th>
                <th scope="col">Best for</th>
                <th scope="col">Runs on</th>
                <th scope="col">Models</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.roundup.apps}>
                {(app, index) => (
                  <tr style={{ "--compare-index": index() }}>
                    <th scope="row">
                      <SideLabel side={app.mark} name={app.name} mark={appMark(app)} class="compare-table-logo" />
                    </th>
                    <td>{app.bestFor}</td>
                    <td>{app.runsOn}</td>
                    <td>{app.models}</td>
                    <td>{app.price}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </RevealSection>

      <Show when={props.roundup.benchmark}>{(benchmark) => <CompareBenchmark benchmark={benchmark()} />}</Show>

      <p class="compare-intro">{props.roundup.intro}</p>

      <RevealSection class="compare-roundup" titleId="compare-roundup-title" title="The apps">
        <ol class="compare-roundup-list">
          <For each={props.roundup.apps}>
            {(app, index) => (
              <li id={roundupAppAnchor(app)} class="compare-card" style={{ "--compare-index": index() }}>
                <h3 class="compare-card-title">
                  <span class="compare-roundup-rank">{index() + 1}.</span>
                  <SideLabel side={app.mark} name={app.name} mark={appMark(app)} />
                </h3>
                <p class="compare-roundup-best">Best for: {app.bestFor}</p>
                <p class="compare-card-text">{app.summary}</p>
                <Show when={app.comparisons.length > 0}>
                  <ul class="compare-roundup-links">
                    <For each={app.comparisons}>
                      {(slug) => (
                        <li>
                          <Link to={props.collection.articleRoute} params={{ slug }}>
                            {findArticle(props.collection, slug)?.title ?? slug}
                            <LandingIcon name="arrow-right" class="compare-roundup-link-icon" />
                          </Link>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </li>
            )}
          </For>
        </ol>
      </RevealSection>

      <CompareFaq faq={props.roundup.faq} />

      <CompareSources subject="these apps" page={props.roundup} />
    </DataArticleFrame>
  );
}
