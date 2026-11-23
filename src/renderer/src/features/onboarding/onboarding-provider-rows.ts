import type { AgentProviderId } from "@openbot/contracts/ipc";
import type { ProviderPickerOption } from "@openbot/ui/components/ProviderPicker";

const POPULAR_PROVIDERS: readonly AgentProviderId[] = ["codex", "claude", "antigravity"];
export const FREE_PROVIDER: AgentProviderId = "opencode";
const PLAN_ROWS = 3;

export interface OnboardingProviderRows {
  listed: ProviderPickerOption[];
  hidden: ProviderPickerOption[];
}

function userHasProvider(option: ProviderPickerOption, hostProviders: boolean): boolean {
  if (option.state === "available") return true;
  return !hostProviders && (option.state === "sign-in-required" || option.state === "outdated");
}

function popularFirst(options: readonly ProviderPickerOption[]): ProviderPickerOption[] {
  const rank = (option: ProviderPickerOption) => {
    const index = POPULAR_PROVIDERS.indexOf(option.id);
    return index === -1 ? POPULAR_PROVIDERS.length : index;
  };
  return [...options].sort((left, right) => rank(left) - rank(right));
}

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
