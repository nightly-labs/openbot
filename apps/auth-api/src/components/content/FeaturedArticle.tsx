import { Link } from "@tanstack/solid-router";
import type { CollectionArticle, ContentCollection } from "../../lib/content-collection";
import { ButtonLink } from "../ui/button";
import { ArticleByline } from "./ArticleByline";
import { ArticleGradient } from "./ArticleGradient";

export interface FeaturedArticleProps {
  collection: ContentCollection;
  article: CollectionArticle;
}

export function FeaturedArticle(props: FeaturedArticleProps) {
  return (
    <section class="post-featured" aria-labelledby="post-featured-title">
      <div class="post-featured-copy" data-enter="post-copy">
        <ArticleByline article={props.article} />
        <h2 class="post-featured-title" id="post-featured-title">
          <Link to={props.collection.articleRoute} params={{ slug: props.article.slug }}>
            {props.article.title}
          </Link>
        </h2>
        <p class="post-featured-description">{props.article.description}</p>
        <ButtonLink
          to={props.collection.articleRoute}
          params={{ slug: props.article.slug }}
          variant="primary"
          size="lg"
          icon="arrow-right"
          class="post-featured-action"
          aria-label={`Read more: ${props.article.title}`}
        >
          Read More
        </ButtonLink>
      </div>

      {/* Not a link itself, and it takes no pointer. The heading's link is stretched
          over the whole block by CSS and passes under this frame, so the artwork —
          the biggest target on the page — goes to the article without a screen
          reader hearing the same destination three times. */}
      <div class="post-featured-art" data-enter="post-art">
        <ArticleGradient
          collection={props.collection}
          slug={props.article.slug}
          title={props.article.title}
          mode="live"
          shape="featured"
        />
        <span class="post-featured-art-title" aria-hidden="true">
          {props.article.title}
        </span>
      </div>
    </section>
  );
}
