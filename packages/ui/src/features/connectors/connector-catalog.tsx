import type { SkillCategory } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Lock, MessageCircle } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import {
  DiscordMark,
  GitHubMark,
  OnePasswordMark,
  SlackMark,
  TelegramAccountMark,
  TelegramMark,
} from "../settings/brand-marks";
import type { ConnectorId } from "./connectors";

export interface ConnectorListing {
  title: AppTextKey;
  /** The line under the name on a Marketplace card. */
  tagline: AppTextKey;
  /** The Marketplace category. */
  category: SkillCategory;
  /** The logo, without its tile. */
  Mark: () => JSX.Element;
}

/** What each connector is called and how it looks, on every screen that lists it. */
export const CONNECTOR_LISTINGS: Readonly<Record<ConnectorId, ConnectorListing>> = {
  slack: {
    title: "connector.slack.title",
    tagline: "marketplace.app.slackTagline",
    category: "productivity",
    Mark: () => <SlackMark />,
  },
  discord: {
    title: "connector.discord.title",
    tagline: "marketplace.app.discordTagline",
    category: "productivity",
    Mark: () => <DiscordMark />,
  },
  telegram: {
    title: "connector.telegram.title",
    tagline: "marketplace.app.telegramTagline",
    category: "productivity",
    Mark: () => <TelegramMark />,
  },
  github: {
    title: "connector.github.title",
    tagline: "marketplace.app.githubTagline",
    category: "coding",
    Mark: () => <GitHubMark />,
  },
  onepassword: {
    title: "connector.onePassword.title",
    tagline: "marketplace.app.onePasswordTagline",
    category: "productivity",
    Mark: () => <OnePasswordMark />,
  },
  bitwarden: {
    title: "connector.bitwarden.title",
    tagline: "marketplace.app.bitwardenTagline",
    category: "productivity",
    Mark: () => <Lock aria-hidden="true" />,
  },
  "telegram-account": {
    title: "connector.telegramAccount.title",
    tagline: "marketplace.app.telegramAccountTagline",
    category: "productivity",
    Mark: () => <TelegramAccountMark />,
  },
  "whatsapp-account": {
    title: "connector.whatsappAccount.title",
    tagline: "marketplace.app.whatsappAccountTagline",
    category: "productivity",
    Mark: () => <MessageCircle aria-hidden="true" />,
  },
};
