import { cx } from "@openbot/ui/utils";
import { type CollectionArticle, formatArticleDate } from "../../lib/content-collection";

export interface ArticleBylineProps {
  article: CollectionArticle;
  class?: string;
}

export function ArticleByline(props: ArticleBylineProps) {
  return (
    <span class={cx("post-meta post-byline", props.class)}>
      <time datetime={props.article.publishedAt}>{formatArticleDate(props.article.publishedAt)}</time>
      <span aria-hidden="true">·</span>
      <span>{props.article.author}</span>
    </span>
  );
}
