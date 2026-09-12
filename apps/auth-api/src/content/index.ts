// Collection to slug to body. The article page reads this; nothing else does.
//
// Kept apart from src/lib so that the registries stay free of JSX and the
// build-time image generator can import them from plain Bun without pulling in a
// renderer.

import type { CollectionId } from "../lib/content-collection";
import type { ArticleBody } from "./body";
import { GUIDE_BODIES } from "./guides";
import { NEWS_ARTICLE_BODIES } from "./news";

export const ARTICLE_BODIES: Readonly<Record<CollectionId, Readonly<Record<string, ArticleBody>>>> = {
  news: NEWS_ARTICLE_BODIES,
  guides: GUIDE_BODIES,
};
