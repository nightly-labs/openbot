import type { LandingIconName } from "../components/landing/LandingIcon";

export const TEAMS_ROUTE = "/teams";

export const TEAMS_PAGE_UPDATED_AT = "2026-11-06";

export const TEAMS_SOCIAL_IMAGE_PATH = "/social/teams.jpg";

export type TeamsSetupId = "local" | "managed" | "custom";

export const TEAMS_SETUP_IDS = ["local", "managed", "custom"] as const satisfies readonly TeamsSetupId[];

export const TEAMS_BENEFIT_ICONS = ["cloud", "clock", "users", "devices"] as const satisfies readonly LandingIconName[];
