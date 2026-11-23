import type { AppTranslate } from "@openbot/i18n";

export const CREDITS_QUERY_SLOT = "{query}";

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
    perClip: t("sitePage.credits.perClip"),
    video: { title: t("sitePage.credits.video.title"), unit: t("sitePage.credits.video.unit") },
    image: { title: t("sitePage.credits.image.title"), unit: t("sitePage.credits.image.unit") },
    avatar: { title: t("sitePage.credits.avatar.title"), unit: t("sitePage.credits.avatar.unit") },
    edit: { title: t("sitePage.credits.edit.title"), unit: t("sitePage.credits.edit.unit") },
    audio: { title: t("sitePage.credits.audio.title"), unit: t("sitePage.credits.audio.unit") },
  };
}

export type CreditsPageText = ReturnType<typeof creditsPageText>;
