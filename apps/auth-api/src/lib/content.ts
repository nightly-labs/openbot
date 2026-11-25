import { COMPARE_COLLECTION } from "./compare";
import type { ContentCollection } from "./content-collection";
import { GUIDES_COLLECTION } from "./guides";
import { NEWS_COLLECTION } from "./news";
import { PROVIDERS_COLLECTION } from "./providers";

export const CONTENT_COLLECTIONS: readonly ContentCollection[] = [
  NEWS_COLLECTION,
  GUIDES_COLLECTION,
  COMPARE_COLLECTION,
  PROVIDERS_COLLECTION,
];

const PROSE_COLLECTIONS = [NEWS_COLLECTION, GUIDES_COLLECTION] as const;

export const HEADER_COLLECTIONS = [...PROSE_COLLECTIONS, COMPARE_COLLECTION] as const;
