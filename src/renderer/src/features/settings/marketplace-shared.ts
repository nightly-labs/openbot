import type { MarketplaceAgentSummary, MarketplaceSkillSummary, SkillReviewStatus } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { MarketplaceHomeCache } from "@openbot/ui/features/settings/MarketplaceCatalog";
import { currentText } from "@openbot/ui/text";
import type { MarketplaceCalls } from "./marketplace-calls";

/** The two views of a marketplace kind: the public catalog, or the account's own submissions. */
export type MarketplaceTab = "discover" | "mine";

/*
 * The overview caches outlive the dialog, so opening it again does not ask again. Each one belongs to
 * one list function, so a story or a test that replaces the API never reads another one's answer.
 */
const skillHomeCaches = new WeakMap<
  MarketplaceCalls["skills"]["list"],
  MarketplaceHomeCache<MarketplaceSkillSummary>
>();
const agentHomeCaches = new WeakMap<
  MarketplaceCalls["agents"]["list"],
  MarketplaceHomeCache<MarketplaceAgentSummary>
>();

function homeCacheFor<K extends WeakKey, C>(caches: WeakMap<K, C>, key: K, create: () => C): C {
  const cached = caches.get(key);
  if (cached) return cached;
  const created = create();
  caches.set(key, created);
  return created;
}

export const skillHomeCache = (calls: MarketplaceCalls) =>
  homeCacheFor(skillHomeCaches, calls.skills.list, () => new MarketplaceHomeCache<MarketplaceSkillSummary>());
export const agentHomeCache = (calls: MarketplaceCalls) =>
  homeCacheFor(agentHomeCaches, calls.agents.list, () => new MarketplaceHomeCache<MarketplaceAgentSummary>());

/** The account's own submissions, which only the desktop app reads and sends. */
export function publishingCalls(calls: MarketplaceCalls) {
  if (!calls.publishing) throw new Error(currentText().t("marketplace.error.publishDesktopOnly"));
  return calls.publishing;
}

export const REVIEW_STATUS_LABEL = {
  pending: "marketplace.status.pending",
  approved: "marketplace.status.approved",
  rejected: "marketplace.status.rejected",
} as const satisfies Record<SkillReviewStatus, AppTextKey>;

/** The server sends this English text when a skill name is taken. It is a released contract. */
const SKILL_NAME_TAKEN = "A skill with this name already exists.";

/** The SKILL.md example. It shows the file syntax, so it stays in English. */

export function marketplaceErrorMessage(cause: unknown): string {
  const text = currentText();
  const message = text.errorMessage(cause, text.t("marketplace.error.actionFailed"));
  if (message === SKILL_NAME_TAKEN) return text.t("marketplace.error.skillNameTaken");
  return message;
}
