import type { AppTranslate, LayoutDirection } from "@openbot/i18n";
import { appLanguageOption } from "@openbot/i18n/languages";
import type { SiteLocale } from "./site-paths";
import { slot } from "./text-slots";

export function siteText(t: AppTranslate) {
  const currentLanguage = (locale: SiteLocale) =>
    t("sitePage.site.language.current", { language: appLanguageOption(locale).label });
  const love = slot("love");
  const [madeBefore = "", madeAfter = ""] = t("sitePage.site.footer.made", { love }).split(love);
  const download = t("sitePage.site.download");
  const sourceCode = t("sitePage.site.sourceCode");
  const brand = t("sitePage.site.brand");
  const changelog = t("sitePage.site.changelog");
  const status = t("sitePage.site.status");
  const documentation = t("sitePage.site.documentation");
  const contact = t("sitePage.site.contact");
  const sections = {
    news: {
      label: t("sitePage.site.news"),
      summary: t("sitePage.site.news.summary"),
      index: t("sitePage.site.news.index"),
    },
    guides: {
      label: t("sitePage.site.guides"),
      summary: t("sitePage.site.guides.summary"),
      index: t("sitePage.site.guides.index"),
    },
    compare: {
      label: t("sitePage.site.compare"),
      summary: t("sitePage.site.compare.summary"),
      index: t("sitePage.site.compare.index"),
    },
    plugins: {
      label: t("sitePage.site.plugins"),
      summary: t("sitePage.site.plugins.summary"),
      index: t("sitePage.site.plugins.index"),
    },
    resources: {
      label: t("sitePage.site.resources"),
      summary: t("sitePage.site.resources.summary"),
      index: sourceCode,
    },
  };
  const links = { teams: t("sitePage.site.forTeams"), pricing: t("sitePage.site.pricing") };
  return {
    download,
    app: t("sitePage.site.app"),
    primaryNavigation: t("sitePage.site.primaryNavigation"),
    siteMenu: t("sitePage.site.siteMenu"),
    openMenu: t("sitePage.site.openMenu"),
    closeMenu: t("sitePage.site.closeMenu"),
    language: {
      label: t("sitePage.site.language"),
      current: {
        en: currentLanguage("en"),
        ar: currentLanguage("ar"),
        de: currentLanguage("de"),
        es: currentLanguage("es"),
        fr: currentLanguage("fr"),
        he: currentLanguage("he"),
        it: currentLanguage("it"),
        ja: currentLanguage("ja"),
        ko: currentLanguage("ko"),
        nl: currentLanguage("nl"),
        pl: currentLanguage("pl"),
        pt: currentLanguage("pt"),
        ru: currentLanguage("ru"),
        tr: currentLanguage("tr"),
        zh: currentLanguage("zh"),
      } satisfies Record<SiteLocale, string>,
    },
    latest: t("sitePage.site.latest"),
    home: t("sitePage.site.home"),
    logo: {
      menu: t("sitePage.site.logo.menu"),
      copyIcon: t("sitePage.site.logo.copyIcon"),
      copyLockup: t("sitePage.site.logo.copyLockup"),
      downloadAssets: t("sitePage.site.logo.downloadAssets"),
      openBrand: t("sitePage.site.logo.openBrand"),
    },
    sections,
    resources: {
      download: { label: download, description: t("sitePage.site.download.description") },
      changelog: { label: changelog, description: t("sitePage.site.changelog.description") },
      community: { label: t("sitePage.site.community"), description: t("sitePage.site.community.description") },
      documentation: { label: documentation, description: t("sitePage.site.documentation.description") },
      brand: { label: brand, description: t("sitePage.site.brand.description") },
      status: { label: status, description: t("sitePage.site.status.description") },
    },
    links,
    cta: {
      title: t("sitePage.site.cta.title"),
      description: t("sitePage.site.cta.description"),
      download: t("sitePage.site.downloadOpenBot"),
      contact,
    },
    footer: {
      description: t("sitePage.site.footer.description"),
      download: t("sitePage.site.downloadOpenBot"),
      navigation: t("sitePage.site.footer.navigation"),
      columns: {
        product: t("sitePage.site.footer.product"),
        resources: sections.resources.label,
        providers: t("sitePage.site.footer.providers"),
        compare: sections.compare.label,
      },
      links: {
        download,
        news: sections.news.label,
        guides: sections.guides.label,
        marketplace: t("sitePage.site.footer.marketplace"),
        changelog,
        teams: t("sitePage.site.footer.teams"),
        pricing: links.pricing,
        contact,
        brand,
        sourceCode,
        license: t("sitePage.site.footer.license"),
        privacy: t("sitePage.site.footer.privacy"),
        terms: t("sitePage.site.footer.terms"),
        commercialLicense: t("sitePage.site.footer.commercialLicense"),
        documentation,
        troubleshooting: t("sitePage.site.footer.troubleshooting"),
        status,
        selfHosted: t("sitePage.site.footer.selfHosted"),
        architecture: t("sitePage.site.footer.architecture"),
        contributing: t("sitePage.site.footer.contributing"),
        localModels: t("sitePage.site.footer.localModels"),
        allProviders: t("sitePage.site.footer.allProviders"),
        bestApps: t("sitePage.site.footer.bestApps"),
        allComparisons: sections.compare.index,
      },
      rights: t("sitePage.site.footer.rights", { year: new Date().getFullYear() }),
      available: t("sitePage.site.footer.available"),
      made: { before: madeBefore.trim(), after: madeAfter.trim() },
      love: t("sitePage.site.footer.love"),
    },
  };
}

type SiteText = ReturnType<typeof siteText>;

export type SiteResourceId = keyof SiteText["resources"];
export type SiteLinkId = keyof SiteText["links"];
export type FooterColumnId = keyof SiteText["footer"]["columns"];
export type FooterTextId = keyof SiteText["footer"]["links"];

export interface SiteChrome {
  lang: string;
  dir: LayoutDirection;
  locale: SiteLocale;
  text: SiteText;
}
