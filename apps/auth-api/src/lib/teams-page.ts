// The text of the /teams page: OpenBot for Teams, with its setups, benefits and
// custom deployments. The landing page's Teams section links here.
//
// No JSX here, for the same reason `content-collection.ts` holds none.

import type { LandingIconName } from "../components/landing/LandingIcon";
import type { PageSocialImage } from "./site-metadata";

export const TEAMS_ROUTE = "/teams";

/** The sitemap date of the page. Change it when its text changes. */
export const TEAMS_PAGE_UPDATED_AT = "2026-10-16";

export const TEAMS_PAGE_META = {
  title: "OpenBot for Teams",
  description:
    "Run OpenBot on managed infrastructure or let us design a custom deployment around your team, workflows and existing systems.",
} as const;

export const TEAMS_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/teams.jpg",
  alt: "Big plans. Better together. Two OpenBot agents joined by a paper bridge",
};

export const TEAMS_HERO = {
  heading: "Bring a team of AI coworkers into your company",
  intro:
    "Run OpenBot on managed infrastructure or let us design a custom deployment around your team, workflows and existing systems.",
} as const;

/** Each setup has its own colour and icon, which the page sets for this id. */
export type TeamsSetupId = "local" | "managed" | "custom";

export interface TeamsSetup {
  id: TeamsSetupId;
  label: string;
  title: string;
  description: string;
}

export const TEAMS_SETUPS_SECTION = {
  heading: "Choose the setup that fits your team",
  question: "Not sure which setup you need?",
  action: "Talk to us",
} as const;

/** In reading order: from one person to the whole company. */
export const TEAMS_SETUPS: readonly TeamsSetup[] = [
  {
    id: "local",
    label: "Local",
    title: "Run it locally",
    description: "Best for individual users who want to run OpenBot directly on their own infrastructure.",
  },
  {
    id: "managed",
    label: "Managed server",
    title: "Use a managed server",
    description:
      "Keep OpenBot available without relying on a personal computer. We provide and maintain the server, so you can focus on your agents and workflows.",
  },
  {
    id: "custom",
    label: "Custom deployment",
    title: "Build a company-wide setup",
    description:
      "We help configure your environments, agents, permissions and integrations around the way your organization already works.",
  },
];

export interface TeamsBenefit {
  icon: LandingIconName;
  title: string;
  description: string;
}

export const TEAMS_BENEFITS: readonly TeamsBenefit[] = [
  {
    icon: "cloud",
    title: "Your agents work 24/7",
    description:
      "Run OpenBot on managed infrastructure and give your team a shared environment where people, agents and automations work together.",
  },
  {
    icon: "clock",
    title: "Automations that never stop",
    description:
      "Run scheduled routines and recurring workflows 24/7 – even at night, on weekends or when your team is offline.",
  },
  {
    icon: "users",
    title: "Multiplayer collaboration",
    description:
      "Bring people and AI coworkers into one shared server. Team members can work with agents, coordinate tasks and collaborate in the same environment.",
  },
  {
    icon: "devices",
    title: "Access from anywhere",
    description:
      "Connect to your OpenBot environment remotely and continue working from supported desktop or mobile devices.",
  },
];

export const TEAMS_CUSTOM = {
  heading: "OpenBot, adapted to your business",
  intro:
    "Getting a server is only the beginning. If your company needs a complete solution, we can help design and implement OpenBot around your actual processes.",
  items: [
    "Infrastructure setup and configuration",
    "Initial agent configuration",
    "Integration with existing tools and internal systems",
    "Custom features and workflows",
    "Ongoing maintenance and development support",
  ],
} as const;

export const TEAMS_AUDIENCE = {
  heading: "Built for teams ready to unlock the full potential of AI",
  items: [
    "Companies introducing AI agents across multiple departments.",
    "Agencies deploying agent environments for their clients.",
    "Teams that need agents available around the clock.",
    "Organizations that need integrations with internal tools.",
    "Businesses that want implementation support instead of building everything themselves.",
  ],
} as const;

export const TEAMS_CLOSING = {
  heading: "Tell us what you want your AI coworkers to accomplish",
  action: "Discuss your setup",
} as const;
