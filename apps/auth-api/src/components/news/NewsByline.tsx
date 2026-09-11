import { formatNewsDate, type NewsArticle } from "../../lib/news";
import { cx } from "../../lib/utils";

export interface NewsBylineProps {
  article: NewsArticle;
  class?: string;
}

// When an article was published and who wrote it, on one line. Both blocks on the
// index use it, so the featured article and the cards under it cannot drift apart.
// The separator is hidden from assistive technology: it divides the line for the
// eye, and read out it becomes "middle dot" in the middle of a sentence.
export function NewsByline(props: NewsBylineProps) {
  return (
    <span class={cx("news-meta news-byline", props.class)}>
      <time datetime={props.article.publishedAt}>{formatNewsDate(props.article.publishedAt)}</time>
      <span class="news-byline-separator" aria-hidden="true">
        ·
      </span>
      <span class="news-byline-author">{props.article.author}</span>
    </span>
  );
}
