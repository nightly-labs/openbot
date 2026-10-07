import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { For, onSettled } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import type { CollectionArticle, ContentCollection } from "../../lib/content-collection";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import { ArticleGradient } from "./ArticleGradient";
import { ContentCallToAction } from "./ContentCallToAction";

interface DataIndexPageProps {
  collection: ContentCollection;
  title: string;
  /** The accessible name of the card grid. */
  label: string;
  /** The words at the foot of each card. */
  action: string;
  /** The marks on a card's plate. */
  marks: (article: CollectionArticle) => JSX.Element;
}

/** The index of a collection drawn from data, a comparison or a provider page: a hero and a grid of cards. */
export function DataIndexPage(props: DataIndexPageProps) {
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
            <p class="compare-eyebrow">{props.collection.name}</p>
            <h1 class="compare-index-title">{props.title}</h1>
            <p class="compare-index-description">{props.collection.indexDescription}</p>
          </header>

          <section
            ref={grid}
            class="compare-index-grid"
            aria-label={props.label}
            data-revealed={revealed() ? "true" : "false"}
          >
            <For each={props.collection.articles}>
              {(article, index) => (
                <DataIndexCard
                  collection={props.collection}
                  article={article}
                  index={index()}
                  action={props.action}
                  marks={props.marks}
                />
              )}
            </For>
          </section>
        </div>

        <ContentCallToAction />
      </main>

      <LandingFooter />
    </div>
  );
}

function DataIndexCard(props: {
  collection: ContentCollection;
  article: CollectionArticle;
  index: number;
  action: string;
  marks: (article: CollectionArticle) => JSX.Element;
}) {
  let root: HTMLAnchorElement | undefined;

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
        {props.marks(props.article)}
      </div>
      <div class="compare-index-copy">
        <h2 class="compare-index-card-title">{props.article.title}</h2>
        <p class="compare-index-card-description">{props.article.description}</p>
        <span class="compare-index-card-action" aria-hidden="true">
          {props.action}
          <LandingIcon name="arrow-right" class="compare-index-card-arrow" />
        </span>
      </div>
    </Link>
  );
}
