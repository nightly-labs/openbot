import type { JSX } from "@solidjs/web";
import { createTrackedEffect } from "solid-js";
import { type ArticleReference, landingAnalytics } from "../../lib/analytics";
import { type CollectionArticle, type ContentCollection, reportedArticlePath } from "../../lib/content-collection";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { ContentCallToAction } from "./ContentCallToAction";
import { createArticleReadDepth } from "./createArticleReadDepth";
import { MoreArticles } from "./MoreArticles";
import { ReadingProgress } from "./ReadingProgress";

export interface DataArticleFrameProps {
  collection: ContentCollection;
  article: CollectionArticle;
  children: JSX.Element;
}

export function DataArticleFrame(props: DataArticleFrameProps) {
  let articleBody: HTMLElement | undefined;
  const tracked = (): ArticleReference => ({ collection: props.collection.id, slug: props.article.slug });

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
    <div class="landing-page post-article compare-page">
      <SiteHeader page="content" />

      <main class="post-main">
        <article ref={articleBody} class="post-container compare-article">
          {props.children}
        </article>

        <ReadingProgress article={() => articleBody} title={props.article.title} slug={props.article.slug} />

        <MoreArticles collection={props.collection} article={props.article} />

        <ContentCallToAction />
      </main>

      <LandingFooter />
    </div>
  );
}
