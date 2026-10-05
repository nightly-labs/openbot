import { Link } from "@tanstack/solid-router";
import { For, onSettled, Show } from "solid-js";
import { COMPARISONS } from "../../content/compare";
import type { ComparePage } from "../../content/compare/comparison";
import { landingAnalytics } from "../../lib/analytics";
import type { CollectionArticle, ContentCollection } from "../../lib/content-collection";
import { ArticleGradient } from "../content/ArticleGradient";
import { ContentCallToAction } from "../content/ContentCallToAction";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import { CompareMarkRow, CompareMarks } from "./CompareParts";

export interface CompareIndexPageProps {
  collection: ContentCollection<"compare">;
}

export function CompareIndexPage(props: CompareIndexPageProps) {
  let grid: HTMLElement | undefined;
  // No inset margin: the cards sit right under a short hero and are on screen as the page loads.
  const revealed = createLandingReveal(() => grid, { rootMargin: "0px" });

  onSettled(() => landingAnalytics.start(document, window.location.hostname, props.collection.indexRoute));

  return (
    <div class="landing-page post-index compare-page">
      <SiteHeader page="content" />

      <main class="post-main">
        <div class="post-container">
          <header class="compare-index-hero" data-enter="post-copy">
            <div class="landing-hero-grid" aria-hidden="true" />
            <p class="compare-eyebrow">Compare</p>
            <h1 class="compare-index-title">Compare OpenBot</h1>
            <p class="compare-index-description">{props.collection.indexDescription}</p>
          </header>

          <section
            ref={grid}
            class="compare-index-grid"
            aria-label="Comparisons"
            data-revealed={revealed() ? "true" : "false"}
          >
            <For each={props.collection.articles}>
              {(article, index) => <CompareCard collection={props.collection} article={article} index={index()} />}
            </For>
          </section>
        </div>

        <ContentCallToAction />
      </main>

      <LandingFooter />
    </div>
  );
}

function CompareCard(props: { collection: ContentCollection<"compare">; article: CollectionArticle; index: number }) {
  let root: HTMLAnchorElement | undefined;
  const comparison = () => COMPARISONS[props.article.slug];

  return (
    <Link
      ref={root}
      class="compare-index-card"
      to={props.collection.articleRoute}
      params={{ slug: props.article.slug }}
      style={{ "--compare-index": props.index }}
    >
      {/* The featured frame, which is the one the index head preloads. */}
      <div class="compare-index-art" aria-hidden="true">
        <ArticleGradient
          title={props.article.title}
          art={{ collection: props.collection, slug: props.article.slug, shape: "featured" }}
          mode="hover"
          hoverTarget={() => root}
        />
        <Show when={comparison()}>{(page) => <CompareCardMarks page={page()} />}</Show>
      </div>
      <div class="compare-index-copy">
        <h2 class="compare-index-card-title">{props.article.title}</h2>
        <p class="compare-index-card-description">{props.article.description}</p>
        <span class="compare-index-card-action" aria-hidden="true">
          Read the comparison
          <LandingIcon name="arrow-right" class="compare-index-card-arrow" />
        </span>
      </div>
    </Link>
  );
}

function CompareCardMarks(props: { page: ComparePage }) {
  const page = props.page;
  switch (page.kind) {
    case "matchup":
      return (
        <CompareMarks
          small
          sides={[
            { side: "a", ...page.products[0] },
            { side: "b", ...page.products[1] },
          ]}
        />
      );
    case "roundup":
      return <CompareMarkRow apps={page.apps} small />;
    default:
      return (
        <CompareMarks
          small
          sides={[
            { side: "openbot", name: "OpenBot" },
            { side: "rival", name: page.rival.name, mark: page.rival.mark },
          ]}
        />
      );
  }
}
