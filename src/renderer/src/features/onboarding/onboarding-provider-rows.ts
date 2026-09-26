import type { AgentProviderId } from "@openbot/contracts/ipc";
import type { ProviderPickerOption } from "@openbot/ui/components/ProviderPicker";

/** The plan providers that most users have. They fill the plan rows that owned providers leave. */
const POPULAR_PROVIDERS: readonly AgentProviderId[] = ["codex", "claude", "grok"];
/** Always in the list, as the last row: the way in for a user with no plan. */
export const FREE_PROVIDER: AgentProviderId = "opencode";
/** The number of plan rows before the free row. Owned providers can make the list longer. */
const PLAN_ROWS = 3;

export interface OnboardingProviderRows {
  /** The rows of the list, with the free provider last. */
  listed: ProviderPickerOption[];
  /** The providers behind "More providers": plan providers first, then free ones. */
  hidden: ProviderPickerOption[];
}

/**
 * Whether the user has the provider already: it is connected, or its CLI is on the computer and
 * only the sign-in is missing. A download in progress does not count: the user started it from a
 * row, so that row is in `kept` already.
 */
export function userHasProvider(option: ProviderPickerOption): boolean {
  return option.state === "available" || option.state === "sign-in-required" || option.state === "outdated";
}

/**
 * The provider rows of the first-run list.
 *
 * Providers that the user has are never hidden, and come first. Popular providers fill the plan
 * rows up to `PLAN_ROWS`, and the free provider is always last. `kept` holds the rows that must
 * stay in the list in their order: the rows the user saw when they first used the list, and each
 * provider that they chose from "More providers". Thus a row does not move or go away under the
 * pointer when a download finishes or a sign-in changes the state of a provider.
 */
export function onboardingProviderRows(
  options: readonly ProviderPickerOption[],
  kept: readonly AgentProviderId[] = [],
): OnboardingProviderRows {
  const plans = options.filter((option) => option.id !== FREE_PROVIDER);
  const owned = plans.filter(userHasProvider);
  const popular = POPULAR_PROVIDERS.flatMap((id) => {
    const option = plans.find((candidate) => candidate.id === id);
    return option && !userHasProvider(option) ? [option] : [];
  });
  const ruled = [...owned, ...popular].slice(0, Math.max(owned.length, PLAN_ROWS));
  const keptRows = kept.flatMap((id) => plans.filter((option) => option.id === id));
  const listedPlans = [...keptRows, ...ruled.filter((option) => !kept.includes(option.id))];
  const listedIds = new Set(listedPlans.map((option) => option.id));
  const hidden = plans.filter((option) => !listedIds.has(option.id));
  return {
    listed: [...listedPlans, ...options.filter((option) => option.id === FREE_PROVIDER)],
    hidden: [...hidden.filter((option) => !option.freeModels), ...hidden.filter((option) => option.freeModels)],
  };
}
