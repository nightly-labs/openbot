import type { AppTranslate } from "@openbot/i18n";
import type { MarketplaceAgentView, MarketplaceSkillView } from "../../lib/marketplace";
import type { MarketplaceTab } from "../../lib/marketplace-routes";

export interface MarketplaceHeadText {
  title: string;
  description: string;
}

export function marketplaceIndexText(t: AppTranslate): Record<MarketplaceTab, MarketplaceHeadText> {
  return {
    agents: {
      title: t("sitePage.marketplace.agents.title"),
      description: t("sitePage.marketplace.agents.description"),
    },
    skills: {
      title: t("sitePage.marketplace.skills.title"),
      description: t("sitePage.marketplace.skills.description"),
    },
    apps: {
      title: t("sitePage.marketplace.apps.title"),
      description: t("sitePage.marketplace.apps.description"),
    },
  };
}

export interface MarketplaceListingHeadText extends MarketplaceHeadText {
  imageAlt: string;
}

const DESCRIPTION_LENGTH = 200;

export function marketplaceAgentText(t: AppTranslate, agent: MarketplaceAgentView): MarketplaceListingHeadText {
  return {
    title: t("sitePage.marketplace.agentTitle", { name: agent.name }),
    description: (agent.title || agent.description).slice(0, DESCRIPTION_LENGTH),
    imageAlt: t("sitePage.marketplace.agentImageAlt", { name: agent.name, creator: agent.creatorName }),
  };
}

export function marketplaceSkillText(t: AppTranslate, skill: MarketplaceSkillView): MarketplaceListingHeadText {
  return {
    title: t("sitePage.marketplace.skillTitle", { name: skill.name }),
    description: skill.description.slice(0, DESCRIPTION_LENGTH),
    imageAlt: t("sitePage.marketplace.skillImageAlt", { name: skill.name, creator: skill.creatorName }),
  };
}

export interface MarketplaceMissingText {
  title: string;
  body: string;
  open: string;
}

export function marketplaceMissingText(t: AppTranslate): MarketplaceMissingText {
  return {
    title: t("sitePage.marketplace.missing.title"),
    body: t("sitePage.marketplace.missing.body"),
    open: t("sitePage.marketplace.missing.open"),
  };
}
