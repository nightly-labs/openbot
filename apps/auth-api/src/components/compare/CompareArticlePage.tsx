import type { ComparePage } from "../../content/compare/comparison";
import type { CollectionArticle, ContentCollection } from "../../lib/content-collection";
import { ComparisonPage } from "./ComparisonPage";
import { MatchupPage } from "./MatchupPage";
import { RoundupPage } from "./RoundupPage";

export interface CompareArticlePageProps {
  collection: ContentCollection<"compare">;
  article: CollectionArticle;
  page: ComparePage;
}

/** The page for one entry in /compare, chosen by its kind. */
export function CompareArticlePage(props: CompareArticlePageProps) {
  const page = props.page;
  switch (page.kind) {
    case "matchup":
      return <MatchupPage collection={props.collection} article={props.article} matchup={page} />;
    case "roundup":
      return <RoundupPage collection={props.collection} article={props.article} roundup={page} />;
    default:
      return <ComparisonPage collection={props.collection} article={props.article} comparison={page} />;
  }
}
