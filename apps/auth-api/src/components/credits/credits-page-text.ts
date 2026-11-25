import type { AppTranslate } from "@openbot/i18n";

export const CREDITS_QUERY_SLOT = "{query}";
export const CREDITS_SECONDS_SLOT = "{seconds}";

export function creditsPageText(t: AppTranslate) {
  return {
    title: t("sitePage.credits.title"),
    description: t("sitePage.credits.description"),
    heading: t("sitePage.credits.heading"),
    intro: t("sitePage.credits.intro"),
    search: t("sitePage.credits.search"),
    categories: t("sitePage.credits.categories"),
    all: t("sitePage.credits.all"),
    length: t("sitePage.credits.length"),
    seconds: t("sitePage.credits.seconds", { seconds: CREDITS_SECONDS_SLOT }),
    sound: t("sitePage.credits.sound"),
    soundOn: t("sitePage.credits.soundOn"),
    soundOff: t("sitePage.credits.soundOff"),
    empty: t("sitePage.credits.empty", { query: CREDITS_QUERY_SLOT }),
    credits: t("sitePage.credits.credits"),
    perImage: t("sitePage.credits.perImage"),
    perSeconds: t("sitePage.credits.perSeconds", { seconds: CREDITS_SECONDS_SLOT }),
    soon: t("sitePage.credits.soon"),
    video: t("sitePage.credits.video.title"),
    image: t("sitePage.credits.image.title"),
    avatar: t("sitePage.credits.avatar.title"),
    edit: t("sitePage.credits.edit.title"),
    audio: t("sitePage.credits.audio.title"),
  };
}

export type CreditsPageText = ReturnType<typeof creditsPageText>;
