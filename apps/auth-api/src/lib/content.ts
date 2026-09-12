// Every writing section on the site, in the order they are offered. The sitemap
// and the build-time image generator walk this list, so a new collection reaches
// both of them without either being edited.

import type { ContentCollection } from "./content-collection";
import { GUIDES_COLLECTION } from "./guides";
import { NEWS_COLLECTION } from "./news";

export const CONTENT_COLLECTIONS: readonly ContentCollection[] = [NEWS_COLLECTION, GUIDES_COLLECTION];
