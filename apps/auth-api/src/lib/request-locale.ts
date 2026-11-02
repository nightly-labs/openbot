import { isAppLanguage } from "@openbot/contracts/app-language";
import type { TranslatedLocale } from "@openbot/i18n";
import { createIsomorphicFn } from "@tanstack/solid-start";
import { getRequestHeader } from "@tanstack/solid-start/server";

/** One language range of an `Accept-Language` header, with its quality. */
interface LanguageRange {
  tag: string;
  quality: number;
  order: number;
}

/**
 * The language tags of an `Accept-Language` header, best first. Ranges with `q=0`, the `*` range
 * and ranges that do not parse are not included. Equal qualities keep the order of the header.
 */
function acceptedLanguages(header: string | undefined): string[] {
  if (!header) return [];
  const ranges: LanguageRange[] = [];
  header.split(",").forEach((part, order) => {
    const [tag = "", ...params] = part.trim().split(";");
    const qualityParam = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    const quality = qualityParam ? Number(qualityParam.slice(2)) : 1;
    if (!tag || tag === "*" || !Number.isFinite(quality) || quality <= 0) return;
    ranges.push({ tag, quality, order });
  });
  return ranges.sort((a, b) => b.quality - a.quality || a.order - b.order).map((range) => range.tag);
}

/** The first tag whose language has a catalog, matched on the language subtag, or English. */
function firstTranslated(tags: readonly string[]): TranslatedLocale {
  for (const tag of tags) {
    const subtag = tag.split("-")[0]?.toLowerCase() ?? "";
    if (isAppLanguage(subtag) && subtag !== "system") return subtag;
  }
  return "en";
}

/**
 * The language of the public pages that show catalog text. The root route reads it in
 * `beforeLoad`, and each page takes it from `match.context`. The server reads the request's
 * `Accept-Language` header. Hydration does not run `beforeLoad` again: the browser keeps the
 * server's value from the dehydrated context, so the first render matches the server HTML. On a
 * later navigation the browser reads `navigator.languages`, the list that it sends as that header.
 *
 * Only the root route imports this, for the same reason as `servingSiteUrl`.
 */
export const requestLocale = createIsomorphicFn()
  .server(() => firstTranslated(acceptedLanguages(getRequestHeader("accept-language"))))
  .client(() => firstTranslated(globalThis.navigator?.languages ?? []));
