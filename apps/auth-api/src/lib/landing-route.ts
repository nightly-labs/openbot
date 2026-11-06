import { landingPageText } from "./landing-page-text";
import { loadPageText } from "./page-text";
import { loadSiteChrome, SITE_OPEN_GRAPH_LOCALES } from "./site-locale";
import { type HomePageHead, OPENBOT_SITE_URL, openBotHomeHead } from "./site-metadata";
import { pagePaths, SITE_LOCALES, type SiteLocale } from "./site-paths";
import { OPENBOT_SOFTWARE_APPLICATION } from "./software-application";

/** The text of the home page and of its header and footer in `locale`, for the loaders of `/` and `/pl`. */
export async function loadLandingPage(locale: SiteLocale) {
  const [page, site] = await Promise.all([loadPageText(locale, landingPageText), loadSiteChrome(locale)]);
  return { ...page, site };
}

type LandingPageData = Awaited<ReturnType<typeof loadLandingPage>>;

/**
 * The head of the home page. `path` is the address of this route; `/` shows the language of the
 * request, so its canonical address stays `/`, and the `hreflang` links name `/pl` for Polish.
 */
export function landingHead(siteUrl: string, path: string, data: LandingPageData | undefined) {
  if (!data) return { links: [{ rel: "canonical", href: new URL(path, OPENBOT_SITE_URL).toString() }] };
  const locale = data.site.locale;
  const head: HomePageHead = {
    title: data.text.title,
    description: data.text.description,
    questions: data.text.faq.questions,
    path,
    openGraphLocale: SITE_OPEN_GRAPH_LOCALES[locale],
    alternates: SITE_LOCALES.map((alternate) => ({ hreflang: alternate, path: pagePaths("/")[alternate] })),
  };
  return openBotHomeHead(OPENBOT_SOFTWARE_APPLICATION, siteUrl, head);
}
