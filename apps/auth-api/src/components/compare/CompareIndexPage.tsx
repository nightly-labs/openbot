import { AppLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { For, onSettled, Show } from "solid-js";
import { COMPARISONS } from "../../content/compare";
import { landingAnalytics } from "../../lib/analytics";
import type { CollectionArticle, ContentCollection } from "../../lib/content-collection";
import { ArticleGradient } from "../content/ArticleGradient";
import { ContentCallToAction } from "../content/ContentCallToAction";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import { RivalMark } from "./RivalMark";

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
        <Show when={comparison()}>
          {(entry) => (
            <span class="compare-marks compare-marks-small">
              <span class="compare-mark" data-side="openbot">
                <AppLogo variant="production" class="compare-mark-logo" />
              </span>
              <span class="compare-vs">vs</span>
              <span class="compare-mark" data-side="rival">
                <RivalMark name={entry().rival.mark} class="compare-mark-logo compare-mark-rival" />
              </span>
            </span>
          )}
        </Show>
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
