import type { JSX } from "@solidjs/web";
import { createTrackedEffect } from "solid-js";
import { type ArticleReference, landingAnalytics } from "../../lib/analytics";
import { type CollectionArticle, type ContentCollection, reportedArticlePath } from "../../lib/content-collection";
import { ContentCallToAction } from "../content/ContentCallToAction";
import { createArticleReadDepth } from "../content/createArticleReadDepth";
import { MoreArticles } from "../content/MoreArticles";
import { ReadingProgress } from "../content/ReadingProgress";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";

export interface CompareArticleFrameProps {
  collection: ContentCollection<"compare">;
  article: CollectionArticle;
  children: JSX.Element;
}

/** What every comparison page has around its content: the header, the analytics, the reading progress and the footer. */
export function CompareArticleFrame(props: CompareArticleFrameProps) {
  let articleBody: HTMLElement | undefined;
  const tracked = (): ArticleReference => ({ collection: props.collection.id, slug: props.article.slug });

  // Tracked for the same reason as on the article page: a link between two
  // comparisons keeps this route and only changes the parameter.
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
