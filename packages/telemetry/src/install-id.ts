import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

/**
 * The analytics ID of one install when the user does not share analytics with their account. It is
 * random and has no part of the account, the device or the email. It changes after 13 months.
 */
interface AnalyticsInstallId {
  id: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
}

/** 13 months, rounded down to whole days. */
const ANALYTICS_INSTALL_ID_MAX_AGE_MS = 395 * 24 * 60 * 60 * 1_000;
const INSTALL_ID_PATTERN = /^install-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** `uuid` comes from the platform's random UUID function. */
export function newAnalyticsInstallId(uuid: string, now: number): AnalyticsInstallId {
  return { id: `install-${uuid.toLowerCase()}`, createdAt: now };
}

/** The saved ID, or null when it is missing, damaged, from the future or older than 13 months. */
export function currentAnalyticsInstallId(saved: unknown, now: number): AnalyticsInstallId | null {
  if (!isDynamicRecord(saved) || !isString(saved.id) || !isNumber(saved.createdAt)) return null;
  if (!INSTALL_ID_PATTERN.test(saved.id)) return null;
  const age = now - saved.createdAt;
  if (!Number.isFinite(age) || age < 0 || age >= ANALYTICS_INSTALL_ID_MAX_AGE_MS) return null;
  return { id: saved.id, createdAt: saved.createdAt };
}
