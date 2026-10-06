import type { MarketplaceAgentSummary, MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import { MarketplaceHomeCache } from "@openbot/ui/features/marketplace/marketplace-listing";
import { currentText } from "@openbot/ui/text";
import type { MarketplaceCalls } from "./marketplace-calls";

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

export function marketplaceErrorMessage(cause: unknown): string {
  const text = currentText();
  return text.errorMessage(cause, text.t("marketplace.error.actionFailed"));
}
