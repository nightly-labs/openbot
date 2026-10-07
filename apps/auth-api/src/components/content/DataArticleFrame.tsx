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

/**
 * What every page drawn from data, a comparison or a provider page, has around its
 * content: the header, the analytics, the reading progress and the footer.
 */
export function DataArticleFrame(props: DataArticleFrameProps) {
  let articleBody: HTMLElement | undefined;
  const tracked = (): ArticleReference => ({ collection: props.collection.id, slug: props.article.slug });

  // Tracked for the same reason as on the article page: a link between two
  // pages of a collection keeps this route and only changes the parameter.
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
