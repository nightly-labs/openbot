// What an article body is, for both collections. It lives on its own so that the
// two registries of bodies and the map that joins them can all name the type
// without importing each other.

import type { JSX } from "@solidjs/web";

export type ArticleBody = () => JSX.Element;
