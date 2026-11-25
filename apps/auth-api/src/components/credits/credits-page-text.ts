import type { AppTranslate } from "@openbot/i18n";

export const CREDITS_QUERY_SLOT = "{query}";
export const CREDITS_AMOUNT_SLOT = "{credits}";

export function creditsPageText(t: AppTranslate) {
  return {
    title: t("sitePage.credits.title"),
    description: t("sitePage.credits.description"),
    heading: t("sitePage.credits.heading"),
    intro: t("sitePage.credits.intro"),
    search: t("sitePage.credits.search"),
    categories: t("sitePage.credits.categories"),
    all: t("sitePage.credits.all"),
    empty: t("sitePage.credits.empty", { query: CREDITS_QUERY_SLOT }),
    credits: t("sitePage.credits.credits"),
    perImage: t("sitePage.credits.perImage"),
    perSecond: t("sitePage.credits.perSecond"),
    perGeneration: t("sitePage.credits.perGeneration"),
    model: t("sitePage.credits.model"),
    oneSize: t("sitePage.credits.oneSize"),
    notAvailable: t("sitePage.credits.notAvailable"),
    withoutSound: t("sitePage.credits.withoutSound", { credits: CREDITS_AMOUNT_SLOT }),
    soon: t("sitePage.credits.soon"),
    video: t("sitePage.credits.video.title"),
    image: t("sitePage.credits.image.title"),
    avatar: t("sitePage.credits.avatar.title"),
    edit: t("sitePage.credits.edit.title"),
    audio: t("sitePage.credits.audio.title"),
  };
}

export type CreditsPageText = ReturnType<typeof creditsPageText>;
