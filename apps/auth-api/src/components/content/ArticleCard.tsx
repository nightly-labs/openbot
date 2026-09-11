import { Link } from "@tanstack/solid-router";
import type { CollectionArticle, ContentCollection } from "../../lib/content-collection";
import { ArticleByline } from "./ArticleByline";
import { ArticleGradient } from "./ArticleGradient";

export interface ArticleCardProps {
  collection: ContentCollection;
  article: CollectionArticle;
  /** Position in the grid, used only to stagger the reveal. */
  index: number;
}

// The title appears twice on purpose: once over the artwork, once below it. The
// one over the artwork is decorative and hidden from assistive technology, so the
// card reads as a single link with one name rather than repeating itself.
export function ArticleCard(props: ArticleCardProps) {
  let root: HTMLAnchorElement | undefined;

  return (
    <Link
      ref={root}
      class="post-card"
      to={props.collection.articleRoute}
      params={{ slug: props.article.slug }}
      style={{ "--post-card-index": props.index }}
    >
      <div class="post-card-art">
        <ArticleGradient
          collection={props.collection}
          slug={props.article.slug}
          title={props.article.title}
          mode="hover"
          shape="card"
          hoverTarget={() => root}
        />
        <span class="post-card-art-title" aria-hidden="true">
          {props.article.title}
        </span>
      </div>
      <ArticleByline article={props.article} class="post-card-byline" />
      <h3 class="post-card-title">{props.article.title}</h3>
    </Link>
  );
}
