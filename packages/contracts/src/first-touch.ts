import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

export interface FirstTouch {
  acquisitionSource: FirstTouchAcquisitionSource;
  sourcePlatform: FirstTouchSourcePlatform;
  landingPage: string;
  firstVisitOn: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

export const FIRST_TOUCH_ACQUISITION_SOURCES = ["direct", "search", "social", "github", "other"] as const;
export type FirstTouchAcquisitionSource = (typeof FIRST_TOUCH_ACQUISITION_SOURCES)[number];

export const FIRST_TOUCH_SOURCE_PLATFORMS = [
  "instagram",
  "twitter",
  "reddit",
  "facebook",
  "linkedin",
  "discord",
  "tiktok",
  "youtube",
  "github",
  "google",
  "bing",
  "duckduckgo",
  "brave",
  "yahoo",
  "unknown",
] as const;
export type FirstTouchSourcePlatform = (typeof FIRST_TOUCH_SOURCE_PLATFORMS)[number];

export const FIRST_TOUCH_CAMPAIGN_FIELDS = ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm"] as const;

export const FIRST_TOUCH_STORAGE_KEY = "openbot.first-touch.v1";
export const FIRST_TOUCH_MAX_AGE_DAYS = 90;

export const FIRST_TOUCH_CAMPAIGN_VALUE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const LANDING_PAGE = /^\/[a-z0-9/_-]{0,127}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;

export function parseFirstTouch(value: unknown): FirstTouch | null {
  if (!isDynamicRecord(value)) return null;
  const { acquisitionSource, sourcePlatform, landingPage, firstVisitOn } = value;
  if (
    !isOneOf(FIRST_TOUCH_ACQUISITION_SOURCES, acquisitionSource) ||
    !isOneOf(FIRST_TOUCH_SOURCE_PLATFORMS, sourcePlatform) ||
    !isString(landingPage) ||
    !LANDING_PAGE.test(landingPage) ||
    !isString(firstVisitOn) ||
    !DAY.test(firstVisitOn) ||
    Number.isNaN(Date.parse(`${firstVisitOn}T00:00:00Z`))
  ) {
    return null;
  }
  const touch: FirstTouch = { acquisitionSource, sourcePlatform, landingPage, firstVisitOn };
  for (const field of FIRST_TOUCH_CAMPAIGN_FIELDS) {
    const campaign = value[field];
    if (isString(campaign) && FIRST_TOUCH_CAMPAIGN_VALUE.test(campaign)) touch[field] = campaign;
  }
  return touch;
}

export function firstTouchDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function readFirstTouch(storage: () => Pick<Storage, "getItem">, now: number): FirstTouch | null {
  try {
    const stored = storage().getItem(FIRST_TOUCH_STORAGE_KEY);
    const touch = stored ? parseFirstTouch(JSON.parse(stored)) : null;
    if (!touch) return null;
    const age = now - Date.parse(`${touch.firstVisitOn}T00:00:00Z`);
    return age <= FIRST_TOUCH_MAX_AGE_DAYS * DAY_MS ? touch : null;
  } catch {
    return null;
  }
}

export function rememberFirstTouch(
  storage: () => Pick<Storage, "getItem" | "setItem">,
  touch: FirstTouch,
  now: number,
): void {
  try {
    if (readFirstTouch(storage, now)) return;
    storage().setItem(FIRST_TOUCH_STORAGE_KEY, JSON.stringify(touch));
  } catch {}
}
