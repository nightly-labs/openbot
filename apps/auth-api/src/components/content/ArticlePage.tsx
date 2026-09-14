import { Dynamic } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { createTrackedEffect, For, Show } from "solid-js";
import { ARTICLE_BODIES } from "../../content";
import { type ArticleReference, landingAnalytics } from "../../lib/analytics";
import {
  type CollectionArticle,
  type ContentCollection,
  formatArticleDate,
  reportedArticlePath,
} from "../../lib/content-collection";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { ArticleCard } from "./ArticleCard";
import { ArticleGradient } from "./ArticleGradient";
import { ContentCallToAction } from "./ContentCallToAction";
import { ContentHeader } from "./ContentHeader";
import { createArticleReadDepth } from "./createArticleReadDepth";

export interface ArticlePageProps {
  collection: ContentCollection;
  article: CollectionArticle;
}

export function ArticlePage(props: ArticlePageProps) {
  let more: HTMLElement | undefined;
  let articleBody: HTMLElement | undefined;
  const revealed = createLandingReveal(() => more);

  const body = () => ARTICLE_BODIES[props.collection.id][props.article.slug];
  const others = () => props.collection.articles.filter((article) => article.slug !== props.article.slug);

  const tracked = (): ArticleReference => ({ collection: props.collection.id, slug: props.article.slug });

  // The article's own path, so one article can be told from another in the report. An unpublished
  // slug falls back to the index inside `reportedArticlePath`.
  //
  // Tracked rather than mounted once: a related-article link stays on this route and only changes
  // the parameter, so a mount hook would leave every later event under the first article's path.
  // The effect disposes the previous article's listener before it starts the new one.
  createTrackedEffect(() => {
    const article = tracked();
    return landingAnalytics.start(
      document,
      window.location.hostname,
      reportedArticlePath(props.collection, article.slug),
    );
  });

  createArticleReadDepth(
    () => articleBody,
    tracked,
    (article, depth) => landingAnalytics.trackArticleRead(article, depth),
  );

  return (
    <div class="landing-page post-article">
      <ContentHeader />

      <main class="post-main">
        <article ref={articleBody} class="post-container post-article-body">
          <header class="post-article-header" data-enter="post-copy">
            <Link class="post-article-back" to={props.collection.indexRoute}>
              {props.collection.backLabel}
            </Link>
            <h1 class="post-article-title">{props.article.title}</h1>
            <p class="post-article-standfirst">{props.article.description}</p>
            <p class="post-meta post-article-byline">
              <time datetime={props.article.publishedAt}>{formatArticleDate(props.article.publishedAt)}</time>
              <span aria-hidden="true"> · </span>
              <span>{props.article.author}</span>
              <Show when={props.article.updatedAt}>
                {(updatedAt) => (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span>Updated {formatArticleDate(updatedAt())}</span>
                  </>
                )}
              </Show>
            </p>
          </header>

          {/*
            Keyed, because a link to a related article stays on this route and
            only changes the parameter. The gradient draws from the title it was
            built with and keeps the frame it captured, so a reused one would
            leave the reader looking at the previous article's artwork.
          */}
          <div class="post-article-art" data-enter="post-art">
            <Show when={props.article.slug} keyed>
              {(slug) => (
                <ArticleGradient
                  title={props.article.title}
                  art={{ collection: props.collection, slug, shape: "article" }}
                  mode="live"
                />
              )}
            </Show>
          </div>

          <div class="post-prose" data-enter="post-prose">
            <Show when={body()}>{(Body) => <Dynamic component={Body()} />}</Show>
          </div>
        </article>

        <Show when={others().length > 0}>
          <section
            ref={more}
            class="post-container post-more"
            aria-labelledby="post-more-title"
            data-revealed={revealed() ? "true" : "false"}
          >
            <h2 class="post-more-title" id="post-more-title">
              {props.collection.moreTitle}
            </h2>
            <div class="post-grid">
              <For each={others()}>
                {(article, index) => <ArticleCard collection={props.collection} article={article} index={index()} />}
              </For>
            </div>
          </section>
        </Show>

        <ContentCallToAction />
      </main>

      <LandingFooter />
    </div>
  );
}
