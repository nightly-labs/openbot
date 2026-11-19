import { ProviderLogo } from "@openbot/brand";
import type {
  AccountUsage,
  AccountUsageWindow,
  AgentModelId,
  AgentProviderId,
  AgentProviderStatus,
  AgentReasoningEffort,
  AgentStatus,
  ClientAgentModelOption,
  CustomAgentSummary,
  CustomProviderHarness,
  CustomProviderSummary,
  ForeignProviderId,
  ProviderAccountStatus,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import {
  agentProviderCliName,
  agentProviderName,
  customAgentIdOfModel,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  defaultProviderModel,
  isCustomProviderHarness,
  isReasoningEffort,
  PICKER_PROVIDERS,
  providerDisplayName,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { planLimitWindowKind, spentUsageWindow } from "@openbot/team-client/plan-limits";
import {
  Badge,
  Button,
  Input,
  KeyRound,
  Layers,
  Listbox,
  Plus,
  Popover,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SlidersHorizontal,
  Tabs,
  Text,
  Tooltip,
  Zap,
} from "@openbot/ui";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { cx } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { formatUsageReset, usageWindowLabel } from "../features/account/account-usage-view";
import { currentText, type TextValue, useText } from "../text";
import { createScrollFades } from "./createScrollFades";
import { findModelOption, isApiKeyAccount, providerAccountName } from "./provider-accounts";
import {
  customProviderIds,
  groupPickerModels,
  isCustomEndpointModel,
  isCustomModel,
  type PickerModel,
  type PickerModelGroup,
  pickerModels,
  providerAvailability,
  providerTurnedOff,
  providerUsable,
  splitServiceName,
} from "./provider-model-options";
import { SwapLabel, type SwapMotion } from "./SwapLabel";

interface ProviderModelPickerProps {
  provider: AgentProviderId;
  value: AgentModelId;
  modelOptions: ClientAgentModelOption[];
  agentStatus: AgentStatus;
  variant?: "pill" | "field";
  ariaLabel?: string;
  label?: string;
  icon?: JSX.Element;
  reasoningEffort?: AgentReasoningEffort | undefined;
  onReasoningEffortChange?: ((effort: AgentReasoningEffort) => void) | undefined;
  fastMode?: boolean | undefined;
  ultrafast?: boolean | undefined;
  onFastModeChange?: ((fastMode: boolean, ultrafast: boolean) => void) | undefined;
  disabled?: boolean | undefined;
  disabledReason?: string;
  runtimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  canConnectProvider?: ((provider: AgentProviderId) => boolean) | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  customAgents?: readonly CustomAgentSummary[] | undefined;
  onAddCustomProvider?: ((trigger: HTMLElement) => void) | undefined;
  onManageProviders?: ((trigger: HTMLElement) => void) | undefined;
  accountChoice?: boolean;
  providerAccountId?: string | null | undefined;
  accountUsage?: AccountUsage | null | undefined;
  workspaceOnly?: boolean | undefined;
  foreignProvider?: ForeignProviderId | undefined;
  onChange: (
    model: AgentModelId,
    provider: AgentProviderId,
    accountId?: string | null,
    reasoningEffort?: AgentReasoningEffort,
  ) => void;
}

type RailId = AgentProviderId | "custom";

const CUSTOM_RAIL = "custom" as const;

const PROVIDERS: readonly RailId[] = [...PICKER_PROVIDERS, CUSTOM_RAIL];

type RailKey = RailId | `${AgentProviderId}:${string}`;

const RAIL_TOOLTIP = {
  placement: "left",
  gutter: 8,
  openDelay: 150,
  closeDelay: 0,
  skipDelayDuration: 300,
} as const;

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function resetTime(window: AccountUsageWindow | undefined): number {
  return window?.resetsAt ?? Number.POSITIVE_INFINITY;
}

type PickerText = Pick<TextValue, "t" | "sourceText">;

const RUNTIME_ACTION_LABEL = {
  Cancel: "common.cancel",
  Connect: "provider.action.connect",
  Retry: "common.retry",
  Download: "common.download",
} as const satisfies Record<string, AppTextKey>;

export const REASONING_LABEL = {
  none: "provider.effort.none",
  minimal: "provider.effort.minimal",
  low: "provider.effort.low",
  medium: "provider.effort.medium",
  high: "provider.effort.high",
  xhigh: "provider.effort.xhigh",
  max: "provider.effort.max",
  ultra: "provider.effort.ultra",
} as const satisfies Record<AgentReasoningEffort, AppTextKey>;

const TRIGGER_SWAP: SwapMotion = {
  distance: 6,
  blur: 6,
  enter: { duration: 320, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
  leave: { duration: 180, easing: "ease" },
};

export function ProviderModelPicker(props: ProviderModelPickerProps) {
  const text = useText();
  const { t, format } = text;
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");
  let trigger: HTMLButtonElement | undefined;
  const providerButtons = new Map<RailKey, HTMLButtonElement>();
  let root: HTMLDivElement | undefined;
  let popover: HTMLElement | undefined;

  const visibleProviders = createMemo(() =>
    PROVIDERS.filter((provider) => provider === CUSTOM_RAIL || !providerTurnedOff(props.agentStatus, provider)),
  );
  const railPool = (rail: RailId) => {
    if (rail === CUSTOM_RAIL) return null;
    const status = props.agentStatus?.providers?.find((row) => row.id === rail);
    const pool = status?.accountPool;
    if (!pool) return null;
    const accounts = status?.accounts ?? [];
    const members = accounts.filter(
      (account) => !isApiKeyAccount(account.id, rail) && !pool.leftOut.includes(account.id),
    );
    const accountsText = t("provider.account.count", { count: members.length });
    const summary = t("provider.account.poolCount", { accounts: accountsText });
    return {
      inUse: pool.inUse,
      summary:
        pool.inUse && accounts.some((account) => account.id === pool.inUse)
          ? t("provider.account.poolInUse", { pool: summary, name: providerAccountName(t, accounts, pool.inUse) })
          : summary,
    };
  };
  const railAccounts = (rail: RailId): readonly ProviderAccountStatus[] => {
    if (!props.accountChoice || rail === CUSTOM_RAIL) return [];
    const accounts = props.agentStatus?.providers?.find((status) => status.id === rail)?.accounts ?? [];
    if (railPool(rail)) return accounts.filter((account) => isApiKeyAccount(account.id, rail));
    return accounts.length > 1 ? accounts : [];
  };
  const railKeys = createMemo<RailKey[]>(() =>
    visibleProviders().flatMap((rail): RailKey[] => {
      const accounts = railAccounts(rail);
      if (!accounts.length || rail === CUSTOM_RAIL) return [rail];
      const keys = accounts.map((account) =>
        account.id === DEFAULT_PROVIDER_ACCOUNT_ID ? rail : (`${rail}:${account.id}` as const),
      );
      return railPool(rail) ? [rail, ...keys] : keys;
    }),
  );
  const chosenAccount = (provider: AgentProviderId, accountId: string | null): string | null | undefined => {
    if (!railAccounts(provider).length) return undefined;
    const keepsPoolPick = railPool(provider) && accountId === null && currentAccount() === null;
    return keepsPoolPick ? undefined : accountId;
  };
  const currentAccount = (): string | null => {
    const id = props.providerAccountId;
    return id && railAccounts(props.provider).some((account) => account.id === id) ? id : null;
  };
  const customIds = createMemo(() => customProviderIds(props.customProviders ?? []));
  const modelOption = (provider: string, id: string) =>
    findModelOption(props.modelOptions, props.agentStatus?.providers, provider, id);
  const selectedModel = createMemo(
    () =>
      modelOption(props.provider, props.value) ??
      props.modelOptions.find(
        (option) => option.provider === props.provider && cursorModelSelected(option.id, props.value),
      ),
  );
  const selectedFixed = createMemo(() => fixedModelSettings(selectedModel()));
  const activeProvider = (): RailId =>
    props.provider === "acp" || isCustomEndpointModel(props.provider, props.value, customIds())
      ? CUSTOM_RAIL
      : props.provider;
  const activeKey = (): RailKey => {
    const account = currentAccount();
    const rail = activeProvider();
    return account && rail !== CUSTOM_RAIL ? `${rail}:${account}` : rail;
  };
  const [railProvider, setRailProvider] = createSignal<RailKey>(untrack(activeKey));
  let shownProvider = untrack(activeProvider);

  function railModelOptions(rail: RailId): ClientAgentModelOption[] {
    if (rail === CUSTOM_RAIL) return props.modelOptions.filter((option) => isCustomModel(option, customIds()));
    return props.modelOptions.filter((option) => option.provider === rail && !isCustomModel(option, customIds()));
  }

  const agentCount = () => {
    if (!props.agentStatus.providers?.some((item) => item.id === "acp")) return 0;
    if (props.customAgents) return props.customAgents.length;
    const ids = props.modelOptions.flatMap((option) =>
      option.provider === "acp" ? [customAgentIdOfModel(option.id) ?? option.id] : [],
    );
    return new Set(ids).size;
  };
  const customSummary = () => {
    const endpoints = props.customProviders?.length ?? 0;
    const agents = agentCount();
    if (agents === 0) {
      return endpoints === 0 ? t("provider.picker.noEndpoints") : t("provider.endpointCount", { count: endpoints });
    }
    if (endpoints === 0) return t("provider.customAgentCount", { count: agents });
    return t("provider.picker.customCounts", {
      endpoints: t("provider.endpointCount", { count: endpoints }),
      agents: t("provider.customAgentCount", { count: agents }),
    });
  };
  const endpointStatus = (): AgentProviderStatus => {
    const status = (harness: CustomProviderHarness) =>
      providerAvailability(props.agentStatus, props.modelOptions, harness, t);
    const harnesses = [...new Set(customIds().values())];
    const available = harnesses.find((harness) => status(harness).state === "available");
    return status(available ?? harnesses[0] ?? DEFAULT_CUSTOM_PROVIDER_HARNESS);
  };
  const endpointsRead = (): boolean => {
    const harnesses = new Set<string>(customIds().values());
    const rows = props.agentStatus.providers?.filter((row) => harnesses.has(row.id)) ?? [];
    return rows.length > 0 && rows.every((row) => row.endpointsPending === false);
  };
  const railStatus = (rail: RailId): AgentProviderStatus => {
    if (rail !== CUSTOM_RAIL) return providerAvailability(props.agentStatus, props.modelOptions, rail, t);
    const endpoints = endpointStatus();
    if (agentCount() === 0) return endpoints;
    const agents = providerAvailability(props.agentStatus, props.modelOptions, "acp", t);
    if (!props.customProviders?.length) return agents;
    return endpoints.state === "available" || agents.state !== "available" ? endpoints : agents;
  };
  const entryAccount = (key: RailKey) => {
    const rail = railOf(key);
    const accounts = railAccounts(rail);
    const id = key === rail ? DEFAULT_PROVIDER_ACCOUNT_ID : key.slice(rail.length + 1);
    const index = accounts.findIndex((account) => account.id === id);
    const account = accounts[index];
    return account ? { account, number: index + 1, name: providerAccountName(t, accounts, id) } : null;
  };
  const entryModelOptions = (key: RailKey): ClientAgentModelOption[] => {
    const shared = railModelOptions(railOf(key));
    const own = entryAccount(key)?.account.models ?? [];
    return own.length ? [...shared, ...own] : shared;
  };
  const entryStatus = (key: RailKey): AgentProviderStatus => {
    const status = railStatus(railOf(key));
    const entry = entryAccount(key);
    if (!entry || entry.account.id === DEFAULT_PROVIDER_ACCOUNT_ID || entry.account.state === "connected") {
      return status;
    }
    const { connectionState: _connection, ...rest } = status;
    return {
      ...rest,
      state:
        entry.account.state === "checking" || entry.account.state === "connecting" ? "checking" : "sign-in-required",
      message: entry.account.message,
    };
  };
  const entryName = (key: RailKey): string => {
    const entry = entryAccount(key);
    return entry ? `${railName(railOf(key), t)} · ${entry.name}` : railName(railOf(key), t);
  };
  const entryUsable = (key: RailKey): boolean => {
    if (key === activeKey()) return true;
    if (
      railOf(key) === CUSTOM_RAIL &&
      !props.customProviders?.length &&
      agentCount() === 0 &&
      !railModelOptions(CUSTOM_RAIL).length
    ) {
      return false;
    }
    const status = entryStatus(key);
    return providerUsable(status, props.runtimeStatuses?.[status.id]);
  };
  const [openedKeys, setOpenedKeys] = createSignal<readonly RailKey[]>([]);
  const visibleKeys = createMemo<RailKey[]>(
    () => {
      const listed = open() ? openedKeys() : [];
      const usable = railKeys().filter((key) => entryUsable(key) || listed.includes(key));
      return usable.length ? usable : railKeys();
    },
    { equals: (previous, next) => previous.length === next.length && previous.every((key, i) => key === next[i]) },
  );
  const modelAvailable = (model: PickerModel): boolean =>
    providerAvailability(props.agentStatus, props.modelOptions, model.provider, t).state === "available";
  const workspaceOnlyBlockedProviders = createMemo(
    () =>
      new Set<string>(
        props.workspaceOnly
          ? props.modelOptions.filter((option) => option.workspaceOnlyUnavailable).map((option) => option.provider)
          : [],
      ),
  );
  const workspaceOnlyBlocked = (model: PickerModel): boolean => workspaceOnlyBlockedProviders().has(model.provider);
  const poolSummary = (key: RailKey, status: AgentProviderStatus): string | undefined =>
    status.state === "available" && key === railOf(key) ? railPool(railOf(key))?.summary : undefined;
  const sourceSummary = (key: RailKey, status: AgentProviderStatus): string | undefined => {
    const rail = railOf(key);
    const source = status.modelSource;
    if (rail === CUSTOM_RAIL || key !== rail || status.state !== "available" || !source) return undefined;
    const cli = agentProviderCliName(rail);
    return source.kind === "provider"
      ? t("provider.picker.modelSourceProvider", { name: source.name, cli })
      : t("provider.picker.modelSourceCatalog", { cli });
  };
  const railSummary = (key: RailKey, status: AgentProviderStatus): string => {
    const rail = railOf(key);
    return rail === CUSTOM_RAIL
      ? customSummary()
      : (sourceSummary(key, status) ?? poolSummary(key, status) ?? providerSummary(rail, status, text));
  };
  const railHeadingSummary = (key: RailKey, status: AgentProviderStatus): string => {
    const rail = railOf(key);
    if (rail !== CUSTOM_RAIL)
      return sourceSummary(key, status) ?? poolSummary(key, status) ?? providerHeadingSummary(rail, status, text);
    return status.state === "available" ? customSummary() : providerStatusLabel(status.state, t);
  };
  const [now, setNow] = createSignal(Date.now());
  const spentWindow = (rail: RailId, accountId: string | null, model: string): AccountUsageWindow | undefined => {
    if (rail === CUSTOM_RAIL) return undefined;
    const spent = spentUsageWindow(
      props.accountUsage?.limits,
      rail,
      accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID,
      model,
      now(),
    );
    return spent?.covers && !spent.onCredits ? spent.window : undefined;
  };
  const entrySpentWindows = (key: RailKey): (AccountUsageWindow | undefined)[] => {
    const rail = railOf(key);
    if (rail === CUSTOM_RAIL || !props.accountUsage) return [];
    const accountId = key === rail ? (railPool(rail)?.inUse ?? null) : key.slice(rail.length + 1);
    return entryModelOptions(key).map((model) => spentWindow(rail, accountId, model.id));
  };
  const entrySpentWindow = (key: RailKey): AccountUsageWindow | undefined => {
    const windows = entrySpentWindows(key);
    let first: AccountUsageWindow | undefined;
    for (const window of windows) {
      if (!window) return undefined;
      if (!first || resetTime(window) < resetTime(first)) first = window;
    }
    return first;
  };
  const spentChipText = (window: AccountUsageWindow): string => {
    const limit =
      planLimitWindowKind(window.windowDurationMins).kind === "limit"
        ? t("provider.picker.usageLimit")
        : t("provider.picker.usageLimitWindow", { window: usageWindowLabel(window.windowDurationMins, text) });
    const time = formatUsageReset(window.resetsAt, text);
    return time ? t("provider.picker.usageLimitResets", { limit, time }) : limit;
  };
  const spentLabel = (name: string, window: AccountUsageWindow | undefined): string => {
    if (!window) return name;
    const time = formatUsageReset(window.resetsAt, text);
    return time
      ? t("provider.picker.usageLimitResetsLabel", { name, time })
      : t("provider.picker.usageLimitLabel", { name });
  };
  createEffect(
    () => {
      if (!open()) return null;
      const next = Math.min(...visibleKeys().flatMap((key) => entrySpentWindows(key).map(resetTime)));
      return Number.isFinite(next) ? next : null;
    },
    (resetsAt) => {
      if (resetsAt === null) return;
      const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, resetsAt * 1_000 - Date.now()));
      const timer = window.setTimeout(() => setNow(Date.now()), delay);
      return () => window.clearTimeout(timer);
    },
  );

  createEffect(
    () => ({ key: activeKey(), open: open(), visible: visibleKeys(), rail: railProvider() }),
    ({ key, open, visible, rail }) => {
      if (!open || !visible.includes(rail)) setRailProvider(visible.includes(key) ? key : (visible[0] ?? CUSTOM_RAIL));
    },
  );

  onSettled(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        !open() ||
        (target instanceof Node && root?.contains(target)) ||
        (target instanceof Element && target.closest(".provider-model-effort-content"))
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  });

  createEffect(
    () => Boolean(props.disabled && open()),
    (mustClose) => {
      if (mustClose) setOpen(false);
    },
  );

  const [queuedEffort, setQueuedEffort] = createSignal<
    { key: RailKey; effort: AgentReasoningEffort } | { key: RailKey; variant: string }
  >();

  function setPickerOpen(next: boolean): void {
    if (props.disabled) return;
    if (next) {
      setNow(Date.now());
      setOpenedKeys(untrack(() => railKeys().filter(entryUsable)));
      const key = activeKey();
      setRailProvider(visibleKeys().includes(key) ? key : (visibleKeys()[0] ?? CUSTOM_RAIL));
      setSearch("");
      setQueuedEffort(undefined);
    }
    setOpen(next);
  }

  function selectModel(option: PickerModel, accountId: string | null, key: RailKey): void {
    if (props.disabled || !modelAvailable(option) || workspaceOnlyBlocked(option)) return;
    if (!showsReasoningEffort() && !option.variants.length) setOpen(false);
    const queued = queuedEffort();
    setQueuedEffort(undefined);
    const account = chosenAccount(option.provider, accountId);
    if (queued?.key !== key) {
      props.onChange(option.id, option.provider, account);
      return;
    }
    if ("variant" in queued) {
      const variantId = queued.variant ? `${option.id}/${queued.variant}` : option.id;
      const variant = option.variants.find((variant) => variant.id === variantId);
      props.onChange(variant?.id ?? option.id, option.provider, account);
      return;
    }
    const effort = modelOption(option.provider, option.id)?.supportedReasoningEfforts.includes(queued.effort)
      ? queued.effort
      : undefined;
    props.onChange(option.id, option.provider, account, effort);
  }

  function selectRailProvider(provider: RailKey): void {
    setRailProvider(provider);
    setSearch("");
  }

  const foreignProviderName = () => {
    const foreign = props.foreignProvider;
    if (foreign === undefined) return undefined;
    const hostLabel = props.agentStatus.providers?.find((status) => {
      const id: string = status.id;
      return id === foreign;
    })?.displayName;
    return providerDisplayName(foreign, hostLabel);
  };
  const foreignModelName = () =>
    props.modelOptions.find((model) => model.provider === props.foreignProvider && model.id === props.value)?.name;
  const triggerModelName = () =>
    displayModelName(props.foreignProvider === undefined ? selectedModel()?.name : foreignModelName(), props.value);
  const field = () => props.variant === "field";
  const showsReasoningEffort = () => props.reasoningEffort !== undefined && props.onReasoningEffortChange !== undefined;
  const selectedHasVariants = createMemo(
    () =>
      props.provider === "opencode" &&
      pickerModels(railModelOptions(activeProvider())).some(
        (model) =>
          model.variants.length > 0 &&
          (model.id === props.value || model.variants.some((variant) => variant.id === props.value)),
      ),
  );
  const triggerEffort = () => {
    const effort = props.reasoningEffort;
    if (props.foreignProvider !== undefined || selectedHasVariants()) return;
    const fixed = selectedFixed();
    if (fixed?.effort) return reasoningLabel(fixed.effort, t);
    if (fixed || !showsReasoningEffort() || !effort) return;
    const model = selectedModel();
    if (!model?.supportedReasoningEfforts.includes(effort) || model.reasoningEffortConfigurable === false) return;
    return reasoningLabel(effort, t);
  };
  const triggerAccount = () => {
    if (props.foreignProvider !== undefined) return null;
    const accounts = railAccounts(props.provider);
    if (!accounts.length || (railPool(props.provider) && currentAccount() === null)) return null;
    return providerAccountName(t, accounts, currentAccount() ?? DEFAULT_PROVIDER_ACCOUNT_ID);
  };
  const savedSpeed = (): Speed =>
    props.fastMode !== true ? "standard" : props.ultrafast === true ? "ultrafast" : "fast";
  const speed = (): Speed => {
    const model = selectedModel();
    const saved = savedSpeed();
    if (saved === "standard" || !model?.fastServiceTier) return "standard";
    return saved === "ultrafast" && model.ultrafastServiceTier ? "ultrafast" : "fast";
  };
  const triggerSpeed = (): Speed => {
    if (props.foreignProvider !== undefined) return "standard";
    if (selectedFixed()?.fast === true) return "fast";
    return props.onFastModeChange ? speed() : "standard";
  };
  const triggerSpeedName = () => {
    const value = triggerSpeed();
    return value === "standard" ? null : speedName(value, t);
  };
  const triggerShownName = () => {
    const fullName = triggerModelName();
    const model = splitServiceName(props.provider, fullName).name;
    const name = !field() && activeProvider() === "opencode" && model.trim() ? model : fullName;
    const prefix = `${railName(activeProvider(), t)} `;
    return !field() && triggerAccount() && name.startsWith(prefix) ? name.slice(prefix.length) || name : name;
  };
  const triggerPool = () =>
    props.foreignProvider === undefined && railPool(props.provider) !== null && currentAccount() === null;
  const triggerSummary = () =>
    [
      triggerModelName(),
      triggerEffort(),
      triggerSpeedName(),
      triggerAccount(),
      triggerPool() ? t("provider.account.poolChip") : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div
      ref={(element) => (root = element)}
      class={["provider-model-picker", { "provider-model-picker-field": field() }]}
    >
      <Popover.Root open={open()} onOpenChange={setPickerOpen} placement="bottom-end" gutter={8} sameWidth={field()}>
        <Popover.Trigger
          ref={trigger}
          type="button"
          class={["provider-model-trigger", { "provider-model-trigger-field": field() }]}
          aria-label={`${props.ariaLabel ?? t("provider.picker.agentModel")}: ${triggerSummary()}`}
          disabled={props.disabled || props.foreignProvider !== undefined}
          title={
            foreignProviderName() !== undefined
              ? t("provider.picker.updateToUse", { name: foreignProviderName() ?? "" })
              : props.disabled
                ? props.disabledReason
                : `${railName(activeProvider(), t)} · ${triggerSummary()}`
          }
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            setPickerOpen(true);
          }}
        >
          <Show when={field() && props.icon}>{props.icon}</Show>
          <Show when={field()}>
            <span class="provider-model-field-label">{props.label ?? t("provider.picker.model")}</span>
          </Show>
          <span class="provider-model-trigger-value">
            <For each={[activeProvider()]} keyed={(provider) => provider}>
              {(provider) => {
                const entering = untrack(provider) !== shownProvider;
                shownProvider = untrack(provider);
                return (
                  <span class="provider-model-trigger-mark" data-entering={entering ? "" : undefined}>
                    <Show
                      when={props.foreignProvider === undefined}
                      fallback={<ProviderLogo provider="unknown" class="provider-model-mark" />}
                    >
                      <ProviderMark provider={provider()} />
                    </Show>
                  </span>
                );
              }}
            </For>
            <SwapLabel class="provider-model-trigger-name" text={triggerShownName()} motion={TRIGGER_SWAP} />
            <Show when={triggerEffort()}>
              {(effort) => (
                <span class="provider-model-trigger-effort">
                  <SwapLabel text={effort()} motion={TRIGGER_SWAP} />
                </span>
              )}
            </Show>
            <Show when={triggerSpeedName()}>
              {(name) => (
                <span class="provider-model-trigger-effort provider-model-trigger-fast">
                  <Zap aria-hidden="true" />
                  <SwapLabel text={name()} motion={TRIGGER_SWAP} />
                </span>
              )}
            </Show>
            <Show when={triggerAccount()}>
              {(account) => (
                <span class="provider-model-trigger-effort provider-model-trigger-account">
                  <SwapLabel text={account()} motion={TRIGGER_SWAP} />
                </span>
              )}
            </Show>
            <Show when={triggerPool()}>
              <span class="provider-model-trigger-effort provider-model-trigger-fast">
                <Layers aria-hidden="true" />
                {t("provider.account.poolChip")}
              </span>
            </Show>
          </span>
          <ChevronDownIcon />
        </Popover.Trigger>

        <Popover.Content
          ref={(element) => (popover = element)}
          class="provider-model-popover"
          aria-hidden={open() ? undefined : "true"}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setOpen(false);
          }}
        >
          <ContentExitMotion panel={() => popover} />
          <Popover.Title class="sr-only">{t("provider.picker.title")}</Popover.Title>
          <Tabs.Root
            value={railProvider()}
            onChange={(value) => {
              const provider = visibleKeys().find((candidate) => candidate === value);
              if (provider) selectRailProvider(provider);
            }}
            orientation="vertical"
            activationMode="automatic"
            class="provider-model-layout"
          >
            <div class="provider-model-rail">
              <Tabs.List class="provider-model-rail-tabs" aria-label={t("provider.picker.providers")}>
                <For each={visibleKeys()}>
                  {(key) => {
                    const provider = railOf(key);
                    const account = () => entryAccount(key);
                    const status = () => entryStatus(key);
                    const name = () => entryName(key);
                    return (
                      <Tooltip.Root {...RAIL_TOOLTIP}>
                        <Tooltip.Trigger as="div" class="provider-model-rail-tooltip-trigger">
                          <Tabs.Trigger
                            ref={(element) => providerButtons.set(key, element)}
                            value={key}
                            class={[
                              "provider-model-rail-button",
                              {
                                "provider-model-rail-button-selected": railProvider() === key,
                                "provider-model-rail-button-unavailable": status().state !== "available",
                              },
                            ]}
                            data-state={status().state}
                            aria-label={spentLabel(
                              `${name()}: ${railSummary(key, status())}`,
                              status().state === "available" ? entrySpentWindow(key) : undefined,
                            )}
                            onClick={(event) => {
                              const target = event.currentTarget;
                              selectRailProvider(key);
                              queueMicrotask(() => target.focus({ preventScroll: true }));
                            }}
                            onKeyDown={(event) => {
                              const delta =
                                event.key === "ArrowDown" || event.key === "ArrowRight"
                                  ? 1
                                  : event.key === "ArrowUp" || event.key === "ArrowLeft"
                                    ? -1
                                    : 0;
                              if (!delta) return;
                              const providers = visibleKeys();
                              const current = providers.indexOf(key);
                              const next = providers[(current + delta + providers.length) % providers.length];
                              if (next) providerButtons.get(next)?.focus();
                            }}
                          >
                            <ProviderMark provider={provider} large />
                            <Show when={account()}>
                              {(entry) => (
                                <span class="provider-model-rail-account" aria-hidden="true">
                                  <Show when={isApiKeyAccount(entry().account.id)} fallback={entry().number}>
                                    <KeyRound />
                                  </Show>
                                </span>
                              )}
                            </Show>
                            <Show when={key === provider && railPool(provider)}>
                              <span class="provider-model-rail-account" aria-hidden="true">
                                <Layers />
                              </span>
                            </Show>
                          </Tabs.Trigger>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content class="provider-model-rail-tooltip">
                            <strong>{name()}</strong>
                            <small>{railSummary(key, status())}</small>
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    );
                  }}
                </For>
              </Tabs.List>
              <Show when={props.onManageProviders}>
                {(manageProviders) => (
                  <Tooltip.Root {...RAIL_TOOLTIP}>
                    <Tooltip.Trigger as="div" class="provider-model-rail-tooltip-trigger">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        class="provider-model-rail-button provider-model-rail-add"
                        aria-label={t("provider.picker.addProvider")}
                        onClick={() => {
                          trigger?.focus({ preventScroll: true });
                          setOpen(false);
                          if (trigger) manageProviders()(trigger);
                        }}
                      >
                        <Plus />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content class="provider-model-rail-tooltip">
                        <strong>{t("provider.picker.addProvider")}</strong>
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                )}
              </Show>
            </div>

            <For each={visibleKeys()}>
              {(key) => {
                const provider = railOf(key);
                const account = () => entryAccount(key);
                const accountId = () => {
                  const id = account()?.account.id;
                  return id && id !== DEFAULT_PROVIDER_ACCOUNT_ID ? id : null;
                };
                const status = () => entryStatus(key);
                const models = createMemo(() => pickerModels(entryModelOptions(key), props.customProviders));
                const endpointModelsElsewhere = () =>
                  provider !== CUSTOM_RAIL &&
                  railModelOptions(CUSTOM_RAIL).some((option) => option.provider === provider);
                const [showOlder, setShowOlder] = createSignal(false);
                const olderExpanded = () => (showOlder() ? "true" : "false");
                const selected = createMemo(() =>
                  accountId() !== currentAccount()
                    ? undefined
                    : models().find(
                        (model) =>
                          model.provider === props.provider &&
                          (cursorModelSelected(model.id, props.value) ||
                            model.variants.some((variant) => variant.id === props.value)),
                      ),
                );
                const selectedKey = () => {
                  const model = selected();
                  return model ? pickerModelKey(model) : props.value;
                };
                const searching = () => search().trim() !== "";
                const older = createMemo(() =>
                  models().filter((model) => model.listing === "older" && model !== selected()),
                );
                const main = createMemo(() =>
                  models().filter((model) => model.listing !== "older" || model === selected()),
                );
                const folds = () => !searching() && older().length > 0 && main().length > 0;
                const groups = createMemo(() => groupPickerModels(folds() ? main() : models(), search()));
                const olderGroups = createMemo(() => (folds() && showOlder() ? groupPickerModels(older(), "") : []));
                const ownsSelection = () =>
                  provider === CUSTOM_RAIL
                    ? selected()?.provider === props.provider
                    : provider === props.provider &&
                      accountId() === currentAccount() &&
                      (!isCustomProviderHarness(props.provider) || Boolean(selected()));
                function modelList(list: { label: string; groups: PickerModelGroup[] }): JSX.Element {
                  return (
                    <Listbox.Root<PickerModel, PickerModelGroup>
                      class="provider-model-list"
                      aria-label={list.label}
                      options={list.groups}
                      optionGroupChildren="models"
                      renderSection={(section) => (
                        <Show when={section.rawValue.name}>
                          <Listbox.Section class="provider-model-group">{section.rawValue.name}</Listbox.Section>
                        </Show>
                      )}
                      optionValue={pickerModelKey}
                      optionTextValue={(model) => displayModelName(model.name, model.id)}
                      optionDisabled={(model) => !modelEnabled(model)}
                      value={[selectedKey()]}
                      selectionMode="single"
                      disallowEmptySelection
                      shouldFocusWrap
                      renderItem={(item) => {
                        const model = item.rawValue;
                        const isSelected = () => selectedKey() === pickerModelKey(model);
                        const settings = () =>
                          fixedModelSettingsText(fixedModelSettings(modelOption(model.provider, model.id)), t);
                        const label = () =>
                          [displayModelName(model.name, model.id), settings()].filter(Boolean).join(", ");
                        return (
                          <Listbox.Item
                            as="button"
                            item={item}
                            type="button"
                            class={["provider-model-option", { "provider-model-option-selected": isSelected() }]}
                            aria-label={spentLabel(
                              model.id === railDefaultModel(provider)
                                ? t("provider.picker.defaultModelLabel", { name: label() })
                                : label(),
                              spentWindow(provider, accountId(), model.id),
                            )}
                            disabled={!modelEnabled(model)}
                            onClick={() => {
                              if (!isSelected()) selectModel(model, accountId(), key);
                            }}
                          >
                            <span class="provider-model-option-name">
                              <span>{displayModelName(model.name, model.id)}</span>
                              <Show when={settings()}>
                                {(text) => <span class="provider-model-option-settings">{text()}</span>}
                              </Show>
                              <Show when={model.free}>
                                <small>{t("provider.model.free")}</small>
                              </Show>
                              <Show when={model.listing === "new"}>
                                <small>{t("provider.model.new")}</small>
                              </Show>
                              <Show when={model.id === railDefaultModel(provider)}>
                                <small>{t("provider.model.default")}</small>
                              </Show>
                            </span>
                            <Show when={isSelected()}>
                              <CheckIcon />
                            </Show>
                          </Listbox.Item>
                        );
                      }}
                    />
                  );
                }
                const fades = createScrollFades();
                onSettled(() => fades.stop);
                createEffect(
                  () => ({ groups: groups(), older: olderGroups(), active: railProvider(), open: open() }),
                  () => fades.remeasure(),
                );
                const available = () => status().state === "available";
                const modelEnabled = (model: PickerModel) =>
                  modelAvailable(model) && (accountId() === null || available()) && !workspaceOnlyBlocked(model);
                const effortLocked = () => !available();
                const headingSpent = createMemo(() => (available() ? entrySpentWindow(key) : undefined));
                const pickerModelOption = (model: PickerModel | undefined) =>
                  model && modelOption(model.provider, model.id);
                const effortModel = createMemo(() => {
                  if (ownsSelection()) return selected();
                  const list = main().filter(modelEnabled);
                  return list.find((model) => model.id === railDefaultModel(provider)) ?? list[0];
                });
                const effortOption = () => (ownsSelection() ? selectedModel() : pickerModelOption(effortModel()));
                const effortOptions = createMemo<{ id: string; name: string }[]>(
                  () => {
                    const variants = effortModel()?.variants ?? [];
                    if (variants.length) return variants;
                    const option = effortOption();
                    return showsReasoningEffort() &&
                      option &&
                      option.reasoningEffortConfigurable !== false &&
                      !fixedModelSettings(option)
                      ? option.supportedReasoningEfforts.map((effort) => ({
                          id: effort,
                          name: reasoningLabel(effort, t),
                        }))
                      : [];
                  },
                  {
                    equals: (previous, next) =>
                      previous.length === next.length &&
                      previous.every((option, i) => option.id === next[i]?.id && option.name === next[i]?.name),
                  },
                );
                const effortValue = () => {
                  const model = effortModel();
                  const queued = queuedEffort();
                  if (model?.variants.length) {
                    if (ownsSelection()) return props.value;
                    if (queued?.key !== key || !("variant" in queued)) return model.id;
                    return queued.variant ? `${model.id}/${queued.variant}` : model.id;
                  }
                  if (ownsSelection()) return props.reasoningEffort;
                  if (queued?.key === key && "effort" in queued) return queued.effort;
                  const option = effortOption();
                  const current = props.reasoningEffort;
                  return current && option?.supportedReasoningEfforts.includes(current)
                    ? current
                    : option?.defaultReasoningEffort;
                };
                function chooseEffort(id: string): void {
                  if (props.disabled || effortLocked() || id === effortValue()) return;
                  const model = effortModel();
                  if (model?.variants.length) {
                    if (ownsSelection()) props.onChange(id, model.provider, chosenAccount(model.provider, accountId()));
                    else setQueuedEffort({ key, variant: id === model.id ? "" : id.slice(model.id.length + 1) });
                    return;
                  }
                  const effort = effortOption()?.supportedReasoningEfforts.find((effort) => effort === id);
                  if (!effort) return;
                  if (ownsSelection()) props.onReasoningEffortChange?.(effort);
                  else setQueuedEffort({ key, effort });
                }
                const runtime = () => {
                  const value = props.runtimeStatuses?.[status().id];
                  if (
                    value?.phase === "not-downloaded" &&
                    (status().state === "available" || status().state === "sign-in-required")
                  ) {
                    return { ...value, phase: "ready" as const, version: status().version };
                  }
                  return value;
                };
                const runtimeAction = () => {
                  if (runtime()?.phase === "downloading") return "Cancel" as const;
                  if (available() || status().connectionState === "connecting") return undefined;
                  if (accountId()) return undefined;
                  if (runtime()?.phase === "ready") return "Connect" as const;
                  if (runtime()?.phase === "download-error") return "Retry" as const;
                  if (runtime()?.phase === "not-downloaded") return "Download" as const;
                  if (status().state === "sign-in-required" || status().state === "error") {
                    return props.onConnectProvider && (props.canConnectProvider?.(status().id) ?? true)
                      ? ("Connect" as const)
                      : undefined;
                  }
                  return undefined;
                };
                const [connectError, setConnectError] = createSignal<string | null>(null);
                const runtimeMessage = () => {
                  const runtimeStatus = runtime();
                  if (runtimeStatus?.phase === "downloading") {
                    return t("provider.picker.downloading", {
                      percent: format.percent(Math.round(runtimeStatus.progress ?? 0) / 100),
                    });
                  }
                  if (runtimeStatus?.phase === "finishing") return t("provider.status.settingUp");
                  if (status().connectionState === "connecting")
                    return status().signInPending === false
                      ? t("provider.status.connecting")
                      : t("provider.connecting.browserHint");
                  const failed = connectError();
                  if (failed) return failed;
                  const message = runtimeStatus?.message ?? status().message;
                  return message
                    ? text.sourceText(message)
                    : t("provider.picker.unavailable", { name: railName(provider, t) });
                };
                return (
                  <Tabs.Content
                    value={key}
                    class="provider-model-panel"
                    aria-label={t("provider.picker.models", { name: entryName(key) })}
                  >
                    <div class="provider-model-heading">
                      <div
                        class={[
                          "provider-model-heading-text",
                          { "provider-model-heading-limited": Boolean(headingSpent()) },
                        ]}
                      >
                        <strong>{entryName(key)}</strong>
                        <Show when={headingSpent()}>
                          {(window) => (
                            <Badge as="small" variant="destructive-light" class="provider-model-limit">
                              {spentChipText(window())}
                            </Badge>
                          )}
                        </Show>
                        <span>
                          {account() && status().state === "available"
                            ? (account()?.account.email ?? railHeadingSummary(key, status()))
                            : railHeadingSummary(key, status())}
                        </span>
                      </div>
                      <Show when={provider === CUSTOM_RAIL && !props.onManageProviders && props.onAddCustomProvider}>
                        <Button
                          type="button"
                          size="xs"
                          variant="default"
                          onClick={() => {
                            setOpen(false);
                            if (trigger) props.onAddCustomProvider?.(trigger);
                          }}
                        >
                          <Plus />
                          {t("provider.picker.addProvider")}
                        </Button>
                      </Show>
                    </div>
                    <Show when={!available()}>
                      <div class="provider-model-empty" role="status">
                        <span>{runtimeMessage()}</span>
                        <Show when={runtime()?.phase === "downloading"}>
                          <Progress
                            value={runtime()?.progress ?? 0}
                            aria-label={t("provider.picker.download", { name: railName(provider, t) })}
                          />
                        </Show>
                        <Show when={runtimeAction()}>
                          {(action) => (
                            <Button
                              type="button"
                              size="xs"
                              variant={action() === "Download" ? "default" : "outline"}
                              onClick={() => {
                                const target = status().id;
                                if (action() === "Cancel") void props.onCancelProviderDownload?.(target);
                                else if (action() === "Connect") {
                                  setConnectError(null);
                                  void Promise.resolve(props.onConnectProvider?.(target)).catch((error: unknown) =>
                                    setConnectError(
                                      text.errorMessage(
                                        error,
                                        t("app.provider.connectFailedRetry", { name: railName(provider, t) }),
                                      ),
                                    ),
                                  );
                                } else void props.onDownloadProvider?.(target);
                              }}
                            >
                              {t(RUNTIME_ACTION_LABEL[action()])}
                            </Button>
                          )}
                        </Show>
                      </div>
                    </Show>
                    <Show when={available() && models().some(workspaceOnlyBlocked)}>
                      <div class="provider-model-empty" role="status">
                        {t("provider.picker.workspaceOnlyUnavailable")}
                      </div>
                    </Show>
                    <Input
                      class="provider-model-search"
                      aria-label={t("provider.picker.search")}
                      placeholder={t("provider.picker.search")}
                      value={search()}
                      onValueChange={setSearch}
                    />
                    <div class={["provider-model-scroll", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
                      <Show
                        when={groups().length > 0}
                        fallback={
                          <Show when={available()}>
                            <div class="provider-model-empty" role="status">
                              <Show
                                when={provider === CUSTOM_RAIL && !search().trim()}
                                fallback={
                                  <Show
                                    when={!search().trim() && endpointModelsElsewhere()}
                                    fallback={
                                      search().trim()
                                        ? t("provider.picker.noMatches")
                                        : // Meta sends a signed-in Muse account an empty list where Muse is not offered (#5983).
                                          provider === "muse"
                                          ? t("provider.picker.museNoModels")
                                          : t("provider.picker.noModels", { name: railName(provider, t) })
                                    }
                                  >
                                    <span>
                                      {t("provider.picker.endpointModelsInCustom", { name: railName(provider, t) })}
                                    </span>
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      onClick={() => {
                                        const custom = providerButtons.get(CUSTOM_RAIL);
                                        selectRailProvider(CUSTOM_RAIL);
                                        custom?.focus({ preventScroll: true });
                                        queueMicrotask(() => custom?.focus({ preventScroll: true }));
                                      }}
                                    >
                                      {t("provider.picker.showCustomModels")}
                                    </Button>
                                  </Show>
                                }
                              >
                                <Show
                                  when={props.customProviders?.length && endpointsRead()}
                                  fallback={
                                    <span>
                                      {props.customProviders?.length
                                        ? t("provider.picker.customPending")
                                        : t("provider.picker.customEmpty")}
                                    </span>
                                  }
                                >
                                  <span>
                                    {t("provider.picker.customUnlisted", { name: railName(endpointStatus().id, t) })}
                                  </span>
                                  <Show when={props.onManageProviders}>
                                    {(manageProviders) => (
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="outline"
                                        onClick={() => {
                                          trigger?.focus({ preventScroll: true });
                                          setOpen(false);
                                          if (trigger) manageProviders()(trigger);
                                        }}
                                      >
                                        {t("provider.picker.editEndpoints")}
                                      </Button>
                                    )}
                                  </Show>
                                </Show>
                              </Show>
                            </div>
                          </Show>
                        }
                      >
                        {modelList({
                          label: t("provider.picker.models", { name: railName(provider, t) }),
                          groups: groups(),
                        })}
                        <Show when={folds()}>
                          <Button
                            type="button"
                            variant="ghost"
                            class="provider-model-option provider-model-older"
                            aria-expanded={olderExpanded()}
                            onClick={() => setShowOlder((shown) => !shown)}
                          >
                            <span class="provider-model-option-name">
                              <span>{t("provider.picker.olderModels")}</span>
                              <small>{older().length}</small>
                            </span>
                            <ChevronDownIcon />
                          </Button>
                        </Show>
                        <Show when={olderGroups().length > 0}>
                          {modelList({
                            label: t("provider.picker.olderModelsList", { name: railName(provider, t) }),
                            groups: olderGroups(),
                          })}
                        </Show>
                      </Show>
                    </div>
                    <Show when={effortOptions().length > 0}>
                      <div class="provider-model-effort">
                        <span>{t("provider.picker.effort")}</span>
                        <Select<{ id: string; name: string }>
                          class="provider-model-effort-select"
                          options={effortOptions()}
                          optionValue="id"
                          optionTextValue="name"
                          value={effortOptions().find((option) => option.id === effortValue())}
                          onChange={(option) => option && chooseEffort(option.id)}
                          itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.name}</SelectItem>}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={t("provider.picker.effortLabel")}
                            disabled={effortLocked()}
                          >
                            <SelectValue<{ id: string; name: string }>>
                              {(state) => state.selectedOption()?.name ?? t("provider.picker.selectEffort")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent class="provider-model-effort-content" />
                        </Select>
                      </div>
                    </Show>
                    <Show when={ownsSelection() && effortOptions().length === 0 && selectedFixed()?.effort}>
                      {(effort) => (
                        <div class="provider-model-effort">
                          <span>{t("provider.picker.effort")}</span>
                          <span>
                            {t("provider.picker.effortFixed", {
                              effort: reasoningLabel(effort(), t),
                              provider: railName(provider, t),
                            })}
                          </span>
                        </div>
                      )}
                    </Show>
                    <Show when={ownsSelection() && selectedModel()?.fastServiceTier && props.onFastModeChange}>
                      <div class="provider-model-effort">
                        <span>{t("provider.picker.speed")}</span>
                        <Select<SpeedOption>
                          class="provider-model-effort-select"
                          options={selectedModel()?.ultrafastServiceTier ? ALL_SPEEDS : FAST_SPEEDS}
                          optionValue="id"
                          optionTextValue={(option) => speedName(option.id, t)}
                          value={SPEED_OPTIONS[speed()]}
                          sameWidth={false}
                          placement="bottom-end"
                          onChange={(option) => {
                            if (!option || option.id === savedSpeed() || props.disabled || effortLocked()) return;
                            props.onFastModeChange?.(option.id !== "standard", option.id === "ultrafast");
                          }}
                          itemComponent={(item) => (
                            <SelectItem item={item.item} class="provider-model-speed-item">
                              <span class="provider-model-speed-name">{speedName(item.item.rawValue.id, t)}</span>
                              <Text variant="caption" tone="muted">
                                {t(SPEED_TEXT[item.item.rawValue.id])}
                              </Text>
                            </SelectItem>
                          )}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={t("provider.picker.speed")}
                            disabled={props.disabled || effortLocked()}
                          >
                            <SelectValue<SpeedOption>>
                              {(state) => {
                                const option = state.selectedOption();
                                return option ? speedName(option.id, t) : null;
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent class="provider-model-effort-content provider-model-speed-content" />
                        </Select>
                      </div>
                    </Show>
                  </Tabs.Content>
                );
              }}
            </For>
          </Tabs.Root>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}

function pickerModelKey(model: PickerModel): string {
  return `${model.provider}:${model.id}`;
}

function railOf(key: RailKey): RailId {
  const rail = key.split(":", 1)[0];
  return PROVIDERS.find((candidate) => candidate === rail) ?? CUSTOM_RAIL;
}

function wireProvider(rail: RailId): AgentProviderId {
  return rail === CUSTOM_RAIL ? "opencode" : rail;
}

function railName(rail: RailId, t: AppTranslate): string {
  return rail === CUSTOM_RAIL ? t("provider.picker.custom") : agentProviderName(rail);
}

function railDefaultModel(rail: RailId): AgentModelId | null {
  return rail === CUSTOM_RAIL ? null : defaultProviderModel(rail);
}

function providerSummary(provider: AgentProviderId, status: AgentProviderStatus, text: PickerText): string {
  if (status.state === "available") {
    return status.version
      ? `${status.version} (${agentProviderCliName(provider)})`
      : text.t("provider.picker.cliReady", { cli: agentProviderCliName(provider) });
  }
  return status.message ? text.sourceText(status.message) : providerStatusLabel(status.state, text.t);
}

function providerHeadingSummary(provider: AgentProviderId, status: AgentProviderStatus, text: PickerText): string {
  if (status.state === "available") return providerSummary(provider, status, text);
  return providerStatusLabel(status.state, text.t);
}

function providerStatusLabel(state: AgentProviderStatus["state"], t: AppTranslate): string {
  if (state === "sign-in-required") return t("provider.status.signInRequired");
  if (state === "not-installed") return t("provider.status.notInstalled");
  if (state === "outdated") return t("provider.status.updateRequired");
  if (state === "error") return t("provider.status.unavailable");
  return t("provider.status.checking");
}

function displayModelName(name: string | undefined, fallback: string): string {
  return name?.replace(/^[\s:–—-]+/, "") || fallback;
}

interface FixedModelSettings {
  context: string | null;
  effort: AgentReasoningEffort | null;
  fast: boolean;
}

function cursorModelSelected(listed: string, saved: string): boolean {
  if (listed === saved) return true;
  const left = cursorModelParameters(listed);
  const right = cursorModelParameters(saved);
  if (!left || !right || left.base !== right.base || left.params.size === 0) return false;
  for (const [key, value] of left.params) {
    if (right.params.get(key) !== value) return false;
  }
  return true;
}

function cursorModelParameters(value: string): { base: string; params: Map<string, string> } | null {
  const open = value.indexOf("[");
  if (open <= 0 || !value.endsWith("]")) return null;
  const params = new Map<string, string>();
  for (const pair of value.slice(open + 1, -1).split(",")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator <= 0) return null;
    const key = pair.slice(0, separator);
    if (key === "reasoning" || key === "effort") continue;
    params.set(key, pair.slice(separator + 1));
  }
  return { base: value.slice(0, open), params };
}

function fixedModelSettings(model: ClientAgentModelOption | undefined): FixedModelSettings | null {
  if (model?.provider !== "cursor") return null;
  const params = /\[([^\]]*)\]$/u.exec(model.id)?.[1];
  if (!params) return null;
  const settings: FixedModelSettings = { context: null, effort: null, fast: false };
  for (const pair of params.split(",")) {
    const [key, value = ""] = pair.split("=");
    if (key === "context" && /^\d+(?:\.\d+)?[km]$/iu.test(value)) settings.context = value;
    else if ((key === "reasoning" || key === "effort" || key === "reasoning_effort") && isReasoningEffort(value))
      settings.effort = value;
    else if (key === "fast") settings.fast = value === "true";
  }
  return settings;
}

function fixedModelSettingsText(settings: FixedModelSettings | null, t: AppTranslate): string {
  if (!settings) return "";
  return [
    settings.context,
    settings.effort && reasoningLabel(settings.effort, t),
    settings.fast && t("provider.picker.fast"),
  ]
    .filter(Boolean)
    .join(" · ");
}

type Speed = "standard" | "fast" | "ultrafast";

interface SpeedOption {
  id: Speed;
}

const SPEED_OPTIONS: Record<Speed, SpeedOption> = {
  standard: { id: "standard" },
  fast: { id: "fast" },
  ultrafast: { id: "ultrafast" },
};
const FAST_SPEEDS: SpeedOption[] = [SPEED_OPTIONS.standard, SPEED_OPTIONS.fast];
const ALL_SPEEDS: SpeedOption[] = [...FAST_SPEEDS, SPEED_OPTIONS.ultrafast];

const SPEED_NAME: Record<Speed, AppTextKey> = {
  standard: "provider.picker.standard",
  fast: "provider.picker.fast",
  ultrafast: "provider.picker.ultrafast",
};
const SPEED_TEXT: Record<Speed, AppTextKey> = {
  standard: "provider.picker.standardText",
  fast: "provider.picker.fastText",
  ultrafast: "provider.picker.ultrafastText",
};

function speedName(speed: Speed, t: AppTranslate): string {
  return t(SPEED_NAME[speed]);
}

export function reasoningLabel(effort: AgentReasoningEffort, t: AppTranslate = currentText().t): string {
  return t(REASONING_LABEL[effort]);
}

function ProviderMark(props: { provider: RailId; large?: boolean }) {
  const classes = () => cx("provider-model-mark", props.large && "provider-model-mark-large");
  return (
    <Show when={props.provider !== CUSTOM_RAIL} fallback={<SlidersHorizontal class={classes()} />}>
      <ProviderLogo provider={wireProvider(props.provider)} class={classes()} />
    </Show>
  );
}

function ChevronDownIcon() {
  return (
    <svg class="provider-model-chevron ui-glyph-16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg class="provider-model-check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3 8.25 3.1 3.1L13 4.8" />
    </svg>
  );
}
