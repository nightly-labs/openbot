import type { AppTranslate } from "@openbot/i18n";
import type { TeamsSetupId } from "../../lib/teams-page";
import { slot } from "../../lib/text-slots";

/*
 * The text of the /teams page, built from `sitePage.teams.*` catalog keys. The routes `/teams` and
 * `/pl/teams` run `teamsPageText` with `loadPageText`. This module has only a type import of the
 * catalogs, so the page does not pull them into the browser bundle.
 */

/** Splits `text` at the last space: the last word stays on one line with what follows it. */
function splitLastWord(text: string) {
  const space = text.lastIndexOf(" ");
  return { lead: text.slice(0, space), last: text.slice(space + 1) };
}

export function teamsPageText(t: AppTranslate) {
  const [heroBefore = "", heroAfter = ""] = t("sitePage.teams.hero.heading", { team: slot("team") }).split(
    slot("team"),
  );
  const hero = splitLastWord(heroBefore.trim());
  const [closingBefore = "", closingAfter = ""] = t("sitePage.teams.closing.heading", {
    accent: slot("accent"),
  }).split(slot("accent"));
  const setups: Record<TeamsSetupId, { label: string; title: string; description: string }> = {
    local: {
      label: t("sitePage.teams.setups.local.label"),
      title: t("sitePage.teams.setups.local.title"),
      description: t("sitePage.teams.setups.local.description"),
    },
    managed: {
      label: t("sitePage.teams.setups.managed.label"),
      title: t("sitePage.teams.setups.managed.title"),
      description: t("sitePage.teams.setups.managed.description"),
    },
    custom: {
      label: t("sitePage.teams.setups.custom.label"),
      title: t("sitePage.teams.setups.custom.title"),
      description: t("sitePage.teams.setups.custom.description"),
    },
  };
  return {
    title: t("sitePage.teams.title"),
    description: t("sitePage.teams.description"),
    imageAlt: t("sitePage.teams.imageAlt"),
    hero: {
      /** The heading before the avatars, without its last word. */
      lead: hero.lead,
      /** The word before the avatars, which stays on their line. */
      keep: hero.last,
      rest: heroAfter.trim(),
    },
    setups,
    setupsSection: {
      heading: t("sitePage.teams.setups.heading"),
      question: t("sitePage.teams.setups.question"),
      action: t("sitePage.teams.setups.action"),
    },
    /** In the order of `TEAMS_BENEFIT_ICONS`. */
    benefits: [
      {
        title: t("sitePage.teams.benefits.alwaysOn.title"),
        description: t("sitePage.teams.benefits.alwaysOn.description"),
      },
      {
        title: t("sitePage.teams.benefits.automations.title"),
        description: t("sitePage.teams.benefits.automations.description"),
      },
      {
        title: t("sitePage.teams.benefits.multiplayer.title"),
        description: t("sitePage.teams.benefits.multiplayer.description"),
      },
      {
        title: t("sitePage.teams.benefits.anywhere.title"),
        description: t("sitePage.teams.benefits.anywhere.description"),
      },
    ],
    custom: {
      heading: t("sitePage.teams.custom.heading"),
      intro: t("sitePage.teams.custom.intro"),
      items: [
        t("sitePage.teams.custom.infrastructure"),
        t("sitePage.teams.custom.agents"),
        t("sitePage.teams.custom.integrations"),
        t("sitePage.teams.custom.features"),
        t("sitePage.teams.custom.support"),
      ],
    },
    audience: {
      heading: t("sitePage.teams.audience.heading"),
      items: [
        t("sitePage.teams.audience.companies"),
        t("sitePage.teams.audience.agencies"),
        t("sitePage.teams.audience.allDay"),
        t("sitePage.teams.audience.integrations"),
        t("sitePage.teams.audience.support"),
      ],
    },
    closing: {
      /** The heading in words. Each word has `accent` when it is in the accent key. */
      words: [
        ...words(closingBefore, false),
        ...words(t("sitePage.teams.closing.accent"), true),
        ...words(closingAfter, false),
      ],
      action: t("sitePage.teams.closing.action"),
    },
  };
}

function words(text: string, accent: boolean) {
  return text
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => ({ word, accent }));
}

export type TeamsPageText = ReturnType<typeof teamsPageText>;
