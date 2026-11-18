// The /teams page: OpenBot for Teams, with its setups, benefits and custom deployments. The landing
// page's Teams section links here. The text is in `sitePage.teams.*` catalog keys
// (`components/teams/teams-page-text.ts`).
//
// No JSX here, for the same reason `content-collection.ts` holds none.

import type { LandingIconName } from "../components/landing/LandingIcon";

export const TEAMS_ROUTE = "/teams";

/** The sitemap date of the page. Change it when its text changes. */
export const TEAMS_PAGE_UPDATED_AT = "2026-11-06";

/** The social image. Its alt text is the `sitePage.teams.imageAlt` key. */
export const TEAMS_SOCIAL_IMAGE_PATH = "/social/teams.jpg";

/** Each setup has its own colour and icon, which the page sets for this id. */
export type TeamsSetupId = "local" | "managed" | "custom";

/** In reading order: from one person to the whole company. */
export const TEAMS_SETUP_IDS = ["local", "managed", "custom"] as const satisfies readonly TeamsSetupId[];

/** One icon for each benefit of the page text, in the same order. */
export const TEAMS_BENEFIT_ICONS = ["cloud", "clock", "users", "devices"] as const satisfies readonly LandingIconName[];
