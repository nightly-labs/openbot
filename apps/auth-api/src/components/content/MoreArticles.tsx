import { For, Show } from "solid-js";
import type { CollectionArticle, ContentCollection } from "../../lib/content-collection";
import { createLandingReveal } from "../landing/createLandingReveal";
import { ArticleCard } from "./ArticleCard";

export interface MoreArticlesProps {
  collection: ContentCollection;
  /** The article on the page, which the list leaves out. */
  article: CollectionArticle;
}

/** The other articles of the collection, under the one being read. */
export function MoreArticles(props: MoreArticlesProps) {
  let more: HTMLElement | undefined;
  const revealed = createLandingReveal(() => more);
  const others = () => props.collection.articles.filter((article) => article.slug !== props.article.slug);

  return (
    <Show when={others().length > 0}>
      <section
        ref={more}
        class="post-container post-more"
        aria-labelledby="post-more-title"
        data-revealed={revealed() ? "true" : "false"}
      >
        <h2 class="post-more-title" id="post-more-title">
          {props.collection.moreTitle}
        </h2>
        <div class="post-grid">
          <For each={others()}>
            {(article, index) => <ArticleCard collection={props.collection} article={article} index={index()} />}
          </For>
        </div>
      </section>
    </Show>
  );
}
