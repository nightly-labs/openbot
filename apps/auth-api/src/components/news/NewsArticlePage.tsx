import { Dynamic } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { For, onSettled, Show } from "solid-js";
import { NEWS_ARTICLE_BODIES } from "../../content/news";
import { landingAnalytics } from "../../lib/analytics";
import { formatNewsDate, NEWS_ARTICLES, type NewsArticle } from "../../lib/news";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { NewsCallToAction } from "./NewsCallToAction";
import { NewsCard } from "./NewsCard";
import { NewsGradient } from "./NewsGradient";
import { NewsHeader } from "./NewsHeader";

export interface NewsArticlePageProps {
  article: NewsArticle;
}

export function NewsArticlePage(props: NewsArticlePageProps) {
  let more: HTMLElement | undefined;
  const revealed = createLandingReveal(() => more);

  const body = () => NEWS_ARTICLE_BODIES[props.article.slug];
  const others = () => NEWS_ARTICLES.filter((article) => article.slug !== props.article.slug);

  onSettled(() => landingAnalytics.start(document, window.location.hostname, "/news"));

  return (
    <div class="landing-page news-article">
      <NewsHeader />

      <main class="news-main">
        <article class="news-container news-article-body">
          <header class="news-article-header" data-enter="news-copy">
            <Link class="news-article-back" to="/news">
              All news
            </Link>
            <h1 class="news-article-title">{props.article.title}</h1>
            <p class="news-article-standfirst">{props.article.description}</p>
            <p class="news-meta news-article-byline">
              <time datetime={props.article.publishedAt}>{formatNewsDate(props.article.publishedAt)}</time>
              <span aria-hidden="true"> · </span>
              <span>{props.article.author}</span>
              <Show when={props.article.updatedAt}>
                {(updatedAt) => (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span>Updated {formatNewsDate(updatedAt())}</span>
                  </>
                )}
              </Show>
            </p>
          </header>

          <div class="news-article-art" data-enter="news-art">
            <NewsGradient slug={props.article.slug} title={props.article.title} mode="live" shape="article" />
          </div>

          <div class="news-prose" data-enter="news-prose">
            <Show when={body()}>{(Body) => <Dynamic component={Body()} />}</Show>
          </div>
        </article>

        <Show when={others().length > 0}>
          <section
            ref={more}
            class="news-container news-more"
            aria-labelledby="news-more-title"
            data-revealed={revealed() ? "true" : "false"}
          >
            <h2 class="news-more-title" id="news-more-title">
              More from OpenBot
            </h2>
            <div class="news-grid">
              <For each={others()}>{(article, index) => <NewsCard article={article} index={index()} />}</For>
            </div>
          </section>
        </Show>

        <NewsCallToAction />
      </main>

      <LandingFooter />
    </div>
  );
}
