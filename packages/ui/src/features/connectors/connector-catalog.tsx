import type { SkillCategory } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import {
  BitwardenTile,
  DiscordTile,
  GitHubTile,
  OnePasswordTile,
  ProtonPassTile,
  SlackTile,
  TelegramTile,
  WhatsAppTile,
} from "../settings/brand-marks";
import type { ConnectorId } from "./connectors";

export interface ConnectorListing {
  title: AppTextKey;
  /** The line under the name on a Marketplace card. */
  tagline: AppTextKey;
  /** The Marketplace category. */
  category: SkillCategory;
  /** The app icon: the brand color fills the square, as the icon of a catalog app does. */
  Mark: () => JSX.Element;
}

/** What each connector is called and how it looks, on every screen that lists it. */
export const CONNECTOR_LISTINGS: Readonly<Record<ConnectorId, ConnectorListing>> = {
  slack: {
    title: "connector.slack.title",
    tagline: "marketplace.app.slackTagline",
    category: "productivity",
    Mark: () => <SlackTile />,
  },
  discord: {
    title: "connector.discord.title",
    tagline: "marketplace.app.discordTagline",
    category: "productivity",
    Mark: () => <DiscordTile />,
  },
  telegram: {
    title: "connector.telegram.title",
    tagline: "marketplace.app.telegramTagline",
    category: "productivity",
    Mark: () => <TelegramTile />,
  },
  whatsapp: {
    title: "connector.whatsapp.title",
    tagline: "marketplace.app.whatsappTagline",
    category: "productivity",
    Mark: () => <WhatsAppTile />,
  },
  github: {
    title: "connector.github.title",
    tagline: "marketplace.app.githubTagline",
    category: "coding",
    Mark: () => <GitHubTile />,
  },
  onepassword: {
    title: "connector.onePassword.title",
    tagline: "marketplace.app.onePasswordTagline",
    category: "productivity",
    Mark: () => <OnePasswordTile />,
  },
  bitwarden: {
    title: "connector.bitwarden.title",
    tagline: "marketplace.app.bitwardenTagline",
    category: "productivity",
    Mark: () => <BitwardenTile />,
  },
  protonpass: {
    title: "connector.protonPass.title",
    tagline: "marketplace.app.protonPassTagline",
    category: "productivity",
    Mark: () => <ProtonPassTile />,
  },
};
