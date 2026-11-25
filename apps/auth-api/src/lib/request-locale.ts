import { isAppLanguage } from "@openbot/contracts/app-language";
import type { TranslatedLocale } from "@openbot/i18n";
import { createIsomorphicFn } from "@tanstack/solid-start";
import { getCookie, getRequestHeader } from "@tanstack/solid-start/server";
import { chosenSiteLocale, SITE_LOCALE_COOKIE } from "./site-paths";

interface LanguageRange {
  tag: string;
  quality: number;
  order: number;
}

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

function firstTranslated(tags: readonly string[]): TranslatedLocale {
  for (const tag of tags) {
    const subtag = tag.split("-")[0]?.toLowerCase() ?? "";
    if (isAppLanguage(subtag) && subtag !== "system") return subtag;
  }
  return "en";
}

function cookieValue(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

export const requestLocale = createIsomorphicFn()
  .server(
    (): TranslatedLocale =>
      chosenSiteLocale(getCookie(SITE_LOCALE_COOKIE)) ??
      firstTranslated(acceptedLanguages(getRequestHeader("accept-language"))),
  )
  .client(
    (): TranslatedLocale =>
      chosenSiteLocale(cookieValue(globalThis.document?.cookie ?? "", SITE_LOCALE_COOKIE)) ??
      firstTranslated(globalThis.navigator?.languages ?? []),
  );
