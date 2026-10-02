// Every writing section on the site. The sitemap, the feeds and the build-time
// image generator walk this list, so a new collection reaches all of them without
// one of them being edited.

import { COMPARE_COLLECTION } from "./compare";
import type { ContentCollection } from "./content-collection";
import { GUIDES_COLLECTION } from "./guides";
import { NEWS_COLLECTION } from "./news";

export const CONTENT_COLLECTIONS: readonly ContentCollection[] = [
  NEWS_COLLECTION,
  GUIDES_COLLECTION,
  COMPARE_COLLECTION,
];

/** The collections whose articles are prose. A comparison is drawn from data instead. */
export const PROSE_COLLECTIONS = [NEWS_COLLECTION, GUIDES_COLLECTION] as const;

/** The collections the header menu offers, in its order. */
export const HEADER_COLLECTIONS = [...PROSE_COLLECTIONS, COMPARE_COLLECTION] as const;
