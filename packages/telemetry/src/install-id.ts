import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

interface AnalyticsInstallId {
  id: string;
  createdAt: number;
}

const ANALYTICS_INSTALL_ID_MAX_AGE_MS = 395 * 24 * 60 * 60 * 1_000;
const INSTALL_ID_PATTERN = /^install-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function newAnalyticsInstallId(uuid: string, now: number): AnalyticsInstallId {
  return { id: `install-${uuid.toLowerCase()}`, createdAt: now };
}

export function currentAnalyticsInstallId(saved: unknown, now: number): AnalyticsInstallId | null {
  if (!isDynamicRecord(saved) || !isString(saved.id) || !isNumber(saved.createdAt)) return null;
  if (!INSTALL_ID_PATTERN.test(saved.id)) return null;
  const age = now - saved.createdAt;
  if (!Number.isFinite(age) || age < 0 || age >= ANALYTICS_INSTALL_ID_MAX_AGE_MS) return null;
  return { id: saved.id, createdAt: saved.createdAt };
}
