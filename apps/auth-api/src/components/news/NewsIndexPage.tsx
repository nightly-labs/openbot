import { For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { NEWS_ARTICLES } from "../../lib/news";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { NewsCard } from "./NewsCard";
import { NewsFeatured } from "./NewsFeatured";
import { NewsHeader } from "./NewsHeader";

// Newest article on top, the rest in the grid below it. Both come from the same
// sorted registry, so publishing an article moves the previous one down without
// anyone editing this file.
const [FEATURED, ...REST] = NEWS_ARTICLES;

export function NewsIndexPage() {
  let grid: HTMLElement | undefined;
  // No inset margin: the row sits close enough to the top that part of it is on
  // screen as the page loads, and a card that is already visible must not wait for
  // a scroll it will never get.
  const revealed = createLandingReveal(() => grid, { rootMargin: "0px" });

  onSettled(() => landingAnalytics.start(document, window.location.hostname, "/news"));

  return (
    <div class="landing-page news-index">
      <NewsHeader />

      <main class="news-main">
        <div class="news-container">
          {/* The page reads as a wall of articles, so the title is not drawn. It stays
              in the document for the outline a crawler and a screen reader rely on. */}
          <h1 class="landing-visually-hidden">News</h1>

          <Show when={FEATURED}>{(article) => <NewsFeatured article={article()} />}</Show>

          <Show when={REST.length > 0}>
            <section
              ref={grid}
              class="news-grid-section"
              aria-labelledby="news-grid-title"
              data-revealed={revealed() ? "true" : "false"}
            >
              <h2 class="landing-visually-hidden" id="news-grid-title">
                More articles
              </h2>
              <div class="news-grid">
                <For each={REST}>{(article, index) => <NewsCard article={article} index={index()} />}</For>
              </div>
            </section>
          </Show>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
