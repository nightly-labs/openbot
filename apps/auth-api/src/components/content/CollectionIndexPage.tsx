import { For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import type { ContentCollection } from "../../lib/content-collection";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { ArticleCard } from "./ArticleCard";
import { ContentCallToAction } from "./ContentCallToAction";
import { FeaturedArticle } from "./FeaturedArticle";

export interface CollectionIndexPageProps {
  collection: ContentCollection;
}

export function CollectionIndexPage(props: CollectionIndexPageProps) {
  let grid: HTMLElement | undefined;
  const revealed = createLandingReveal(() => grid, { rootMargin: "0px" });

  const featured = () => props.collection.articles[0];
  const rest = () => props.collection.articles.slice(1);

  onSettled(() => landingAnalytics.start(document, window.location.hostname, props.collection.indexRoute));

  return (
    <div class="landing-page post-index">
      <SiteHeader page="content" />

      <main class="post-main">
        <div class="post-container">
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
