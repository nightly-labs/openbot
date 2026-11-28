import type { TranslatedLocale } from "@openbot/i18n";
import { createIsomorphicFn } from "@tanstack/solid-start";
import { getRequestHeader } from "@tanstack/solid-start/server";
import { cookieValue, firstTranslated, serverRequestLocale } from "./request-locale-headers";
import { chosenSiteLocale, SITE_LOCALE_COOKIE } from "./site-paths";

export const requestLocale = createIsomorphicFn()
  .server((): TranslatedLocale => serverRequestLocale(getRequestHeader("cookie"), getRequestHeader("accept-language")))
  .client(
    (): TranslatedLocale =>
      chosenSiteLocale(cookieValue(globalThis.document?.cookie ?? "", SITE_LOCALE_COOKIE)) ??
      firstTranslated(globalThis.navigator?.languages ?? []),
  );
