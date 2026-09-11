import { Link } from "@tanstack/solid-router";
import { formatNewsDate, type NewsArticle } from "../../lib/news";
import { NewsGradient } from "./NewsGradient";

export interface NewsCardProps {
  article: NewsArticle;
  /** Position in the grid, used only to stagger the reveal. */
  index: number;
}

// The title appears twice on purpose: once over the artwork, once below it. The
// one over the artwork is decorative and hidden from assistive technology, so the
// card reads as a single link with one name rather than repeating itself.
export function NewsCard(props: NewsCardProps) {
  let root: HTMLAnchorElement | undefined;

  return (
    <Link
      ref={root}
      class="news-card"
      to="/news/$slug"
      params={{ slug: props.article.slug }}
      style={{ "--news-card-index": props.index }}
    >
      <div class="news-card-art">
        <NewsGradient
          slug={props.article.slug}
          title={props.article.title}
          mode="hover"
          shape="card"
          hoverTarget={() => root}
        />
        <span class="news-card-art-title" aria-hidden="true">
          {props.article.title}
        </span>
      </div>
      <time class="news-meta" datetime={props.article.publishedAt}>
        {formatNewsDate(props.article.publishedAt)}
      </time>
      <h3 class="news-card-title">{props.article.title}</h3>
    </Link>
  );
}
