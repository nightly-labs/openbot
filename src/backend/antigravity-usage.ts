// The Gemini plan quota, read from the Antigravity ACP server's `/usage` command.
//
// From 1.4.1 (`antigravityAnswersUsageCommand`) the server answers a prompt that starts with
// `/usage` itself, with no model turn: it reads the signed-in Google account's quota summary, sends
// one Markdown answer and ends the turn. The answer is text for people, so this reads only the lines
// of its "Quota Limits" section:
//
//   ### Quota Limits
//   - **Gemini Models**
//     *(Models within this group: Gemini Flash, Gemini Pro)*
//     - **Weekly Limit Remaining:** 96% remaining (resets Oct 29, 2026, 10:12 UTC)
//   - **Claude and GPT models**
//     *(Models within this group: Claude Opus, Claude Sonnet, GPT-OSS)*
//     - **Weekly Limit Remaining:** 100% remaining
//
// Google names the groups and can give a model a group of its own, such as Gemini 4 Argon on some
// plans (#3055). The reading carries every group, so the usage popover shows each one. An API key sign-in has no plan quota: the section then says "Not applicable for
// current authentication method", which reads as no usage.

import { usageGroupForModel } from "@openbot/contracts/ipc";
import type {
  AccountRateLimitGroupResult,
  AccountRateLimitsReadResult,
  AccountRateLimitWindowResult,
} from "./protocol";

export const ANTIGRAVITY_USAGE_PROMPT = "/usage";

const FIVE_HOUR_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10_080;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

const SECTION = /^#+\s*Quota Limits\s*$/iu;
const GROUP = /^-\s+\*\*(.+?)\*\*\s*$/u;
const GROUP_MODELS = /^\s+\*\(Models within this group:\s*(.+?)\)\*\s*$/iu;
const BUCKET = /^\s+-\s+\*\*(.+?):\*\*\s+(\d+(?:\.\d+)?)% remaining(?:\s+\(resets ([^)]+)\))?\s*$/u;
const RESET = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) UTC$/u;

type UsageWindow = AccountRateLimitWindowResult & { usedPercent: number };

type QuotaGroup = AccountRateLimitGroupResult & { primary: UsageWindow | null; secondary: UsageWindow | null };

/**
 * The windows of the group that limits `model`. A five-hour bucket is the first window and a weekly
 * one the second, as for Codex. Without a model, the dock's reading, it is the "Gemini Models" group.
 * A model that no group lists has no reading: another group's room does not say that it can run.
 * When Google lists no models at all, the Gemini group covers every model, as one group did before.
 * `groups` holds every group that has a window.
 */
export function antigravityRateLimits(answer: string, model: string | null = null): AccountRateLimitsReadResult {
  const groups = quotaGroups(answer);
  const listed = groups.some((group) => group.models.length > 0);
  const group = model && listed ? usageGroupForModel(groups, model) : geminiGroup(groups);
  if (!group || (!group.primary && !group.secondary)) return NO_USAGE;
  return {
    rateLimits: { limitId: "antigravity", primary: group.primary, secondary: group.secondary },
    rateLimitsByLimitId: null,
    groups: groups.filter((candidate) => candidate.primary || candidate.secondary),
  };
}

function quotaGroups(answer: string): QuotaGroup[] {
  const groups: QuotaGroup[] = [];
  let inSection = false;
  for (const line of answer.split(/\r?\n/u)) {
    if (/^#/u.test(line)) {
      inSection = SECTION.test(line);
      continue;
    }
    if (!inSection) continue;
    const name = GROUP.exec(line)?.[1];
    if (name) {
      groups.push({ name, models: [], primary: null, secondary: null });
      continue;
    }
    const group = groups.at(-1);
    if (!group) continue;
    const models = GROUP_MODELS.exec(line)?.[1];
    if (models) {
      group.models = models
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean);
      continue;
    }
    const bucket = BUCKET.exec(line);
    if (!bucket) continue;
    const bucketName = bucket[1] ?? "";
    const window: UsageWindow = {
      usedPercent: Math.max(0, Math.min(100, 100 - Number(bucket[2]))),
      windowDurationMins: /week/iu.test(bucketName)
        ? WEEKLY_WINDOW_MINS
        : /\b5\s*-?\s*h/iu.test(bucketName)
          ? FIVE_HOUR_WINDOW_MINS
          : null,
      resetsAt: resetSeconds(bucket[3]),
    };
    if (window.windowDurationMins === FIVE_HOUR_WINDOW_MINS) group.primary = bindingWindow(group.primary, window);
    else group.secondary = bindingWindow(group.secondary, window);
  }
  return groups;
}

/** "Gemini Models" by name, else the first group whose name starts with Gemini. */
function geminiGroup(groups: readonly QuotaGroup[]): QuotaGroup | undefined {
  return (
    groups.find((group) => /^gemini models$/iu.test(group.name.trim())) ??
    groups.find((group) => /^gemini\b/iu.test(group.name))
  );
}

function bindingWindow(current: UsageWindow | null, next: UsageWindow): UsageWindow {
  return current && current.usedPercent >= next.usedPercent ? current : next;
}

/** The server writes the reset as "Oct 29, 2026, 10:12 UTC". */
function resetSeconds(text: string | undefined): number | null {
  const match = text ? RESET.exec(text.trim()) : null;
  if (!match) return null;
  const month = MONTHS.indexOf(match[1] ?? "");
  if (month < 0) return null;
  const milliseconds = Date.UTC(Number(match[3]), month, Number(match[2]), Number(match[4]), Number(match[5]));
  return Number.isFinite(milliseconds) ? milliseconds / 1_000 : null;
}
