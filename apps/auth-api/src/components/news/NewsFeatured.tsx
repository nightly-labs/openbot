import { Link } from "@tanstack/solid-router";
import { formatNewsDate, type NewsArticle } from "../../lib/news";
import { ButtonLink } from "../ui/button";
import { NewsGradient } from "./NewsGradient";

export interface NewsFeaturedProps {
  article: NewsArticle;
}

export function NewsFeatured(props: NewsFeaturedProps) {
  return (
    <section class="news-featured" aria-labelledby="news-featured-title">
      <div class="news-featured-copy" data-enter="news-copy">
        <time class="news-meta" datetime={props.article.publishedAt}>
          {formatNewsDate(props.article.publishedAt)}
        </time>
        <h2 class="news-featured-title" id="news-featured-title">
          <Link to="/news/$slug" params={{ slug: props.article.slug }}>
            {props.article.title}
          </Link>
        </h2>
        <p class="news-featured-description">{props.article.description}</p>
        <ButtonLink
          to="/news/$slug"
          params={{ slug: props.article.slug }}
          variant="primary"
          size="lg"
          icon="arrow-right"
          class="news-featured-action"
          aria-label={`Read more: ${props.article.title}`}
        >
          Read More
        </ButtonLink>
      </div>

      {/* Not a link itself, and it takes no pointer. The heading's link is stretched
          over the whole block by CSS and passes under this frame, so the artwork —
          the biggest target on the page — goes to the article without a screen
          reader hearing the same destination three times. */}
      <div class="news-featured-art" data-enter="news-art">
        <NewsGradient slug={props.article.slug} title={props.article.title} mode="live" shape="featured" />
        <span class="news-featured-art-title" aria-hidden="true">
          {props.article.title}
        </span>
      </div>
    </section>
  );
}
