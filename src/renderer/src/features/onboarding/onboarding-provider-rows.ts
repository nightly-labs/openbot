import type { AgentProviderId } from "@openbot/contracts/ipc";
import type { ProviderPickerOption } from "@openbot/ui/components/ProviderPicker";

/**
 * The plan providers that most users have. They come first among the providers that the user has,
 * and they fill the plan rows that those providers leave.
 */
const POPULAR_PROVIDERS: readonly AgentProviderId[] = ["codex", "claude", "antigravity"];
/** Always in the list, as the last row: the way in for a user with no plan. */
export const FREE_PROVIDER: AgentProviderId = "opencode";
/**
 * The number of plan rows before the free row, also when the user has more providers. The others
 * are in "More providers". Only a provider that the user chooses there, or a saved choice, adds a row.
 */
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
 *
 * On a joined server's host, only a connected provider counts. A new server comes with the CLIs of
 * OpenBot installed, so each of them needs only a sign-in, and that tells nothing about the user.
 * The providers that report first, such as the API key providers, would otherwise fill the rows,
 * and the popular providers would replace them when they report.
 */
function userHasProvider(option: ProviderPickerOption, hostProviders: boolean): boolean {
  if (option.state === "available") return true;
  return !hostProviders && (option.state === "sign-in-required" || option.state === "outdated");
}

/** Popular providers first, in `POPULAR_PROVIDERS` order; the others keep their order. */
function popularFirst(options: readonly ProviderPickerOption[]): ProviderPickerOption[] {
  const rank = (option: ProviderPickerOption) => {
    const index = POPULAR_PROVIDERS.indexOf(option.id);
    return index === -1 ? POPULAR_PROVIDERS.length : index;
  };
  return [...options].sort((left, right) => rank(left) - rank(right));
}

/**
 * The provider rows of the first-run list.
 *
 * The list has `PLAN_ROWS` plan rows. Providers that the user has come first: the connected ones,
 * then the ones that need a sign-in or an update, each with the popular ones first. Popular providers fill
 * the rows that are left, and the free provider is always last. The other providers are in "More
 * providers", the ones that the user has first, in the same order.
 *
 * `kept` holds the rows that must stay in the list in their order: the rows the user saw when they
 * first used the list, and each provider that they chose from "More providers". Thus a row does not
 * move or go away under the pointer when a download finishes or a sign-in changes the state of a
 * provider.
 *
 * Without `includeFree`, the list has plan rows only, and the free provider is the last provider in
 * "More providers". The user chose to connect a plan, and can still find it there.
 *
 * With `hostProviders`, the providers are those of a joined server's host: see `userHasProvider`.
 */
export function onboardingProviderRows(
  options: readonly ProviderPickerOption[],
  kept: readonly AgentProviderId[] = [],
  includeFree = true,
  hostProviders = false,
): OnboardingProviderRows {
  const has = (option: ProviderPickerOption) => userHasProvider(option, hostProviders);
  const plans = options.filter((option) => option.id !== FREE_PROVIDER);
  const connected = popularFirst(plans.filter((option) => option.state === "available"));
  const notReady = popularFirst(plans.filter((option) => has(option) && option.state !== "available"));
  const popular = POPULAR_PROVIDERS.flatMap((id) => {
    const option = plans.find((candidate) => candidate.id === id);
    return option && !has(option) ? [option] : [];
  });
  const owned = [...connected, ...notReady];
  const ruled = [...owned, ...popular].slice(0, PLAN_ROWS);
  const keptRows = kept.flatMap((id) => plans.filter((option) => option.id === id));
  const listedPlans = [...keptRows, ...ruled.filter((option) => !kept.includes(option.id))];
  const listedIds = new Set(listedPlans.map((option) => option.id));
  const hidden = plans.filter((option) => !listedIds.has(option.id));
  const free = options.filter((option) => option.id === FREE_PROVIDER);
  return {
    listed: includeFree ? [...listedPlans, ...free] : listedPlans,
    hidden: [
      ...owned.filter((option) => !listedIds.has(option.id)),
      ...hidden.filter((option) => !has(option) && !option.freeModels),
      ...hidden.filter((option) => !has(option) && option.freeModels),
      ...(includeFree ? [] : free),
    ],
  };
}
