import { cx } from "@openbot/ui/utils";
import { type CollectionArticle, formatArticleDate } from "../../lib/content-collection";

export interface ArticleBylineProps {
  article: CollectionArticle;
  class?: string;
}

// When an article was published and who wrote it, on one line. Both blocks on an
// index use it, so the featured article and the cards under it cannot drift apart.
// The separator is hidden from assistive technology: it divides the line for the
// eye, and read out it becomes "middle dot" in the middle of a sentence.
export function ArticleByline(props: ArticleBylineProps) {
  return (
    <span class={cx("post-meta post-byline", props.class)}>
      <time datetime={props.article.publishedAt}>{formatArticleDate(props.article.publishedAt)}</time>
      <span aria-hidden="true">·</span>
      <span>{props.article.author}</span>
    </span>
  );
}
