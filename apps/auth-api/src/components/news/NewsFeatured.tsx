import { formatNewsDate, type NewsArticle, newsArticlePath } from "../../lib/news";
import { Button } from "../ui/button";
import { NewsGradient } from "./NewsGradient";

export interface NewsFeaturedProps {
  article: NewsArticle;
}

export function NewsFeatured(props: NewsFeaturedProps) {
  return (
    <section class="news-featured" aria-labelledby="news-featured-title">
      <div class="news-featured-copy">
        <time class="news-meta" datetime={props.article.publishedAt}>
          {formatNewsDate(props.article.publishedAt)}
        </time>
        <h2 class="news-featured-title" id="news-featured-title">
          <a href={newsArticlePath(props.article.slug)}>{props.article.title}</a>
        </h2>
        <p class="news-featured-description">{props.article.description}</p>
        <Button
          href={newsArticlePath(props.article.slug)}
          variant="primary"
          size="lg"
          icon="arrow-right"
          class="news-featured-action"
          aria-label={`Read more: ${props.article.title}`}
        >
          Read More
        </Button>
      </div>

      {/* Not a link itself. The heading's link is stretched over the whole block by
          CSS, so the artwork — the biggest target on the page — goes to the article
          without a screen reader hearing the same destination three times. */}
      <div class="news-featured-art">
        <NewsGradient slug={props.article.slug} title={props.article.title} mode="live" />
        <span class="news-featured-art-title" aria-hidden="true">
          {props.article.title}
        </span>
      </div>
    </section>
  );
}
