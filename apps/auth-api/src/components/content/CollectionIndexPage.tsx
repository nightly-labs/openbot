import { For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import type { ContentCollection } from "../../lib/content-collection";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { ArticleCard } from "./ArticleCard";
import { ContentCallToAction } from "./ContentCallToAction";
import { ContentHeader } from "./ContentHeader";
import { FeaturedArticle } from "./FeaturedArticle";

export interface CollectionIndexPageProps {
  collection: ContentCollection;
}

export function CollectionIndexPage(props: CollectionIndexPageProps) {
  let grid: HTMLElement | undefined;
  // No inset margin: the row sits close enough to the top that part of it is on
  // screen as the page loads, and a card that is already visible must not wait for
  // a scroll it will never get.
  const revealed = createLandingReveal(() => grid, { rootMargin: "0px" });

  // Newest article on top, the rest in the grid below it. Both come from the same
  // sorted registry, so publishing an article moves the previous one down without
  // anyone editing this file.
  const featured = () => props.collection.articles[0];
  const rest = () => props.collection.articles.slice(1);

  onSettled(() => landingAnalytics.start(document, window.location.hostname, props.collection.indexRoute));

  return (
    <div class="landing-page post-index">
      <ContentHeader />

      <main class="post-main">
        <div class="post-container">
          {/* The page reads as a wall of articles, so the title is not drawn. It stays
              in the document for the outline a crawler and a screen reader rely on. */}
          <h1 class="landing-visually-hidden">{props.collection.name}</h1>

          <Show when={featured()}>
            {(article) => <FeaturedArticle collection={props.collection} article={article()} />}
          </Show>

          <Show when={rest().length > 0}>
            <section
              ref={grid}
              class="post-grid-section"
              aria-labelledby="post-grid-title"
              data-revealed={revealed() ? "true" : "false"}
            >
              <h2 class="landing-visually-hidden" id="post-grid-title">
                {props.collection.moreTitle}
              </h2>
              <div class="post-grid">
                <For each={rest()}>
                  {(article, index) => <ArticleCard collection={props.collection} article={article} index={index()} />}
                </For>
              </div>
            </section>
          </Show>
        </div>

        <ContentCallToAction />
      </main>

      <LandingFooter />
    </div>
  );
}
