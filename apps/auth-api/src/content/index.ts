import type { ProseCollectionId } from "../lib/content-collection";
import type { ArticleBody } from "./body";
import { GUIDE_BODIES } from "./guides";
import { NEWS_ARTICLE_BODIES } from "./news";

export const ARTICLE_BODIES: Readonly<Record<ProseCollectionId, Readonly<Record<string, ArticleBody>>>> = {
  news: NEWS_ARTICLE_BODIES,
  guides: GUIDE_BODIES,
};
