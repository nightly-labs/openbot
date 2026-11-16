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
  /** A glyph before the field label. The `field` variant only. */
  icon?: JSX.Element;
  reasoningEffort?: AgentReasoningEffort | undefined;
  onReasoningEffortChange?: ((effort: AgentReasoningEffort) => void) | undefined;
  /**
   * Fast mode. The picker shows its Speed select only for a model with a fast tier, and only with
   * `onFastModeChange`. With `ultrafast`, the agent asks for the Ultrafast tier in place of Fast.
   */
  fastMode?: boolean | undefined;
  ultrafast?: boolean | undefined;
  onFastModeChange?: ((fastMode: boolean, ultrafast: boolean) => void) | undefined;
  disabled?: boolean | undefined;
  disabledReason?: string;
  runtimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** A signed-out provider shows Connect only when this place has a way in. Without it, every one does. */
  canConnectProvider?: ((provider: AgentProviderId) => boolean) | undefined;
  /** Endpoints the user named; served by OpenCode, separated out only by the picker. */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** The user's own ACP agents; provider `acp`, drawn on the Custom tab with one group each. */
  customAgents?: readonly CustomAgentSummary[] | undefined;
  /** Receives the picker trigger, so focus returns to it when the opened settings close. */
  onAddCustomProvider?: ((trigger: HTMLElement) => void) | undefined;
  /** Opens the provider settings: a plus button after the rail, to connect one. Receives the picker trigger. */
  onManageProviders?: ((trigger: HTMLElement) => void) | undefined;
  /**
   * Gives each account of a provider with more than one its own rail entry, and passes the account
   * of a choice to `onChange`. Only where the agent's account can change.
   */
  accountChoice?: boolean;
  /** The agent's account. Absent or unknown means the provider's own sign-in. */
  providerAccountId?: string | null | undefined;
  /**
   * The plan readings that the Usage rings show. A model that a spent window limits gets a mark;
   * without a reading, no model does. The picker does not ask the provider again.
   */
  accountUsage?: AccountUsage | null | undefined;
  /**
   * The agent's provider when this build does not know it. The host still runs the agent, so the
   * picker shows its model, and it cannot open until OpenBot is updated.
   */
  foreignProvider?: ForeignProviderId | undefined;
  /**
   * `accountId` is passed only with `accountChoice`, for a provider with more than one account: null for its own sign-in.
   * `reasoningEffort` is the effort chosen on the model's tab before the model, when the model has it.
   */
  onChange: (
    model: AgentModelId,
    provider: AgentProviderId,
    accountId?: string | null,
    reasoningEffort?: AgentReasoningEffort,
  ) => void;
}

/** Extra "custom" rail tab; widening the contract id would cost a migration. */
type RailId = AgentProviderId | "custom";

const CUSTOM_RAIL = "custom" as const;

const PROVIDERS: readonly RailId[] = [...PICKER_PROVIDERS, CUSTOM_RAIL];

/**
 * A rail entry: a provider tab, or an account of it after the first. An account entry's key is the
 * provider and the account id; a rail id has no colon.
 */
type RailKey = RailId | `${AgentProviderId}:${string}`;

/** The rail tooltips. The open delay is long enough that sweeping the rail does not flash a name per mark. */
const RAIL_TOOLTIP = {
  placement: "left",
  gutter: 8,
  openDelay: 150,
  closeDelay: 0,
  skipDelayDuration: 300,
} as const;

/** The longest delay that `setTimeout` keeps. A longer one runs at once. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** When a spent window gives its quota back, in seconds. A window with no reset never does. */
function resetTime(window: AccountUsageWindow | undefined): number {
  return window?.resetsAt ?? Number.POSITIVE_INFINITY;
}

/** The part of the interface text that the provider helpers below read. */
type PickerText = Pick<TextValue, "t" | "sourceText">;

/** The panel button for a provider runtime. The value selects the action; the key is its label. */
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

/**
 * The trigger text changes mostly by a blur: a short slide, so the old and new text cross in place,
 * and a gentle curve, so the new text stays soft long enough to see.
 */
const TRIGGER_SWAP: SwapMotion = {
  distance: 6,
  blur: 6,
  enter: { duration: 320, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
  // The old text fades early: the box already eases to the new width and does not clip it.
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
  /**
   * The pool of a provider's accounts, while it is on: the provider then has one rail entry, and its
   * agents use the account that the pool picks.
   */
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
  /**
   * The accounts that get rail entries: only a provider's with more than one, and only on request. A
   * pool has one entry for its accounts, and an entry for each API key, which is not in the pool.
   */
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
  /**
   * The account for `onChange`: only a provider with account entries sends one. The pool entry keeps
   * the account that the pool picked, and sends one only to move the agent off an API key.
   */
  const chosenAccount = (provider: AgentProviderId, accountId: string | null): string | null | undefined => {
    if (!railAccounts(provider).length) return undefined;
    const keepsPoolPick = railPool(provider) && accountId === null && currentAccount() === null;
    return keepsPoolPick ? undefined : accountId;
  };
  /** The agent's account when the rail lists it; otherwise the provider's own sign-in. */
  const currentAccount = (): string | null => {
    const id = props.providerAccountId;
    return id && railAccounts(props.provider).some((account) => account.id === id) ? id : null;
  };
  const customIds = createMemo(() => customProviderIds(props.customProviders ?? []));
  const modelOption = (provider: string, id: string) =>
    findModelOption(props.modelOptions, props.agentStatus?.providers, provider, id);
  const selectedModel = createMemo(() => modelOption(props.provider, props.value));
  const selectedFixed = createMemo(() => fixedModelSettings(selectedModel()));
  /** The tab the current selection lives on: the Custom one for the user's endpoints and agents. */
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
  /** The provider whose mark the trigger shows, so only a changed one springs in. */
  let shownProvider = untrack(activeProvider);

  /** The OpenCode, Pi and Custom tabs split one wire provider so each model appears once. */
  function railModelOptions(rail: RailId): ClientAgentModelOption[] {
    if (rail === CUSTOM_RAIL) return props.modelOptions.filter((option) => isCustomModel(option, customIds()));
    return props.modelOptions.filter((option) => option.provider === rail && !isCustomModel(option, customIds()));
  }

  /**
   * The agents list is this computer's. A joined server's host sends no list, so the count comes from
   * the agents its `acp` models name. A host on a protocol before 5 reports no `acp` row, so its
   * picker counts none of them.
   */
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
  /** The status of the providers that run the saved endpoints: the first available one, or the first. */
  const endpointStatus = (): AgentProviderStatus => {
    const status = (harness: CustomProviderHarness) =>
      providerAvailability(props.agentStatus, props.modelOptions, harness, t);
    const harnesses = [...new Set(customIds().values())];
    const available = harnesses.find((harness) => status(harness).state === "available");
    return status(available ?? harnesses[0] ?? DEFAULT_CUSTOM_PROVIDER_HARNESS);
  };
  /**
   * True when each provider that runs a saved endpoint has read every one of them, so an endpoint
   * without models was left out by the provider and no restart will bring them. A host that does not
   * report it counts as still reading.
   */
  const endpointsRead = (): boolean => {
    const harnesses = new Set<string>(customIds().values());
    const rows = props.agentStatus.providers?.filter((row) => harnesses.has(row.id)) ?? [];
    return rows.length > 0 && rows.every((row) => row.endpointsPending === false);
  };
  /**
   * One provider status per tab. The Custom tab stands for OpenCode or Pi, which serve the endpoints,
   * and for `acp`, which runs the agents: it is available when either of the saved kinds is.
   */
  const railStatus = (rail: RailId): AgentProviderStatus => {
    if (rail !== CUSTOM_RAIL) return providerAvailability(props.agentStatus, props.modelOptions, rail, t);
    const endpoints = endpointStatus();
    if (agentCount() === 0) return endpoints;
    const agents = providerAvailability(props.agentStatus, props.modelOptions, "acp", t);
    if (!props.customProviders?.length) return agents;
    return endpoints.state === "available" || agents.state !== "available" ? endpoints : agents;
  };
  /** The account of a rail entry and its place in the list, when its provider lists accounts. */
  const entryAccount = (key: RailKey) => {
    const rail = railOf(key);
    const accounts = railAccounts(rail);
    const id = key === rail ? DEFAULT_PROVIDER_ACCOUNT_ID : key.slice(rail.length + 1);
    const index = accounts.findIndex((account) => account.id === id);
    const account = accounts[index];
    return account ? { account, number: index + 1, name: providerAccountName(t, accounts, id) } : null;
  };
  /**
   * The models of a rail entry: the provider's list, and then the models that only the entry's
   * account serves, as a plan can serve more than the provider's own sign-in (#5217).
   */
  const entryModelOptions = (key: RailKey): ClientAgentModelOption[] => {
    const shared = railModelOptions(railOf(key));
    const own = entryAccount(key)?.account.models ?? [];
    return own.length ? [...shared, ...own] : shared;
  };
  /** An account after the first that is not signed in cannot run its models, whatever the provider says. */
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
  /** A rail entry the user can choose a model from now, or soon: the agent's own entry always. */
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
  /** The entries listed when the picker opened. An open rail does not drop a tab under the pointer. */
  const [openedKeys, setOpenedKeys] = createSignal<readonly RailKey[]>([]);
  /**
   * The rail lists only the usable entries. When none is, it lists all of them, so the panel always
   * has a tab to show and a provider to download or connect.
   */
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
  /** The pool's line on the pool's entry, in the place of the account's email, while the provider is available. */
  const poolSummary = (key: RailKey, status: AgentProviderStatus): string | undefined =>
    status.state === "available" && key === railOf(key) ? railPool(railOf(key))?.summary : undefined;
  const railSummary = (key: RailKey, status: AgentProviderStatus): string => {
    const rail = railOf(key);
    return rail === CUSTOM_RAIL ? customSummary() : (poolSummary(key, status) ?? providerSummary(rail, status, text));
  };
  const railHeadingSummary = (key: RailKey, status: AgentProviderStatus): string => {
    const rail = railOf(key);
    if (rail !== CUSTOM_RAIL) return poolSummary(key, status) ?? providerHeadingSummary(rail, status, text);
    // OpenCode is what serves a custom endpoint, so its trouble is this tab's trouble.
    return status.state === "available" ? customSummary() : providerStatusLabel(status.state, t);
  };
  /**
   * A window that ended gives the quota back, and its reading stays as it was until something asks
   * the provider again. So the clock is part of the state. It moves when the picker opens and at the
   * next reset while it is open.
   */
  const [now, setNow] = createSignal(Date.now());
  /** The spent plan window that limits a model of a rail entry now. Each account has its own quota. */
  const spentWindow = (rail: RailId, accountId: string | null, model: string): AccountUsageWindow | undefined => {
    if (rail === CUSTOM_RAIL) return undefined;
    const spent = spentUsageWindow(
      props.accountUsage?.limits,
      rail,
      accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID,
      model,
      now(),
    );
    // An account on credits keeps working, so its model is not stopped.
    return spent?.covers && !spent.onCredits ? spent.window : undefined;
  };
  /** The spent window of each model of a rail entry, in the order of the models. */
  const entrySpentWindows = (key: RailKey): (AccountUsageWindow | undefined)[] => {
    const rail = railOf(key);
    if (rail === CUSTOM_RAIL || !props.accountUsage) return [];
    // A pool is spent only when the account that it uses is: it uses another one before a limit.
    const accountId = key === rail ? (railPool(rail)?.inUse ?? null) : key.slice(rail.length + 1);
    return entryModelOptions(key).map((model) => spentWindow(rail, accountId, model.id));
  };
  /**
   * The spent window of a rail entry when one limits every model of the entry: the one that resets
   * first, as that is when a model can run again.
   */
  const entrySpentWindow = (key: RailKey): AccountUsageWindow | undefined => {
    const windows = entrySpentWindows(key);
    let first: AccountUsageWindow | undefined;
    for (const window of windows) {
      if (!window) return undefined;
      if (!first || resetTime(window) < resetTime(first)) first = window;
    }
    return first;
  };
  /** The chip beside the provider name: the spent window and its reset. */
  const spentChipText = (window: AccountUsageWindow): string => {
    const limit =
      planLimitWindowKind(window.windowDurationMins).kind === "limit"
        ? t("provider.picker.usageLimit")
        : t("provider.picker.usageLimitWindow", { window: usageWindowLabel(window.windowDurationMins, text) });
    const time = formatUsageReset(window.resetsAt, text);
    return time ? t("provider.picker.usageLimitResets", { limit, time }) : limit;
  };
  /** A row or tab name with its spent window, for a screen reader. The rows and the tabs show no mark. */
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
      // A month is longer than the longest delay that a timer takes. The picker is not open that long.
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

  /**
   * An effort chosen on a tab that does not hold the agent's model. The next model picked there gets it.
   * `variant` is the suffix of an OpenCode variant id (`<model>/<variant>`); "" is the model's default.
   */
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
    if (props.disabled || !modelAvailable(option)) return;
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

  /** The host's name for a provider that this build does not know. */
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
  /** An OpenCode model with variants: the chosen variant is its effort, and its name says so. */
  const selectedHasVariants = createMemo(
    () =>
      props.provider === "opencode" &&
      pickerModels(railModelOptions(activeProvider())).some(
        (model) =>
          model.variants.length > 0 &&
          (model.id === props.value || model.variants.some((variant) => variant.id === props.value)),
      ),
  );
  /** Only an effort that the model can use. */
  const triggerEffort = () => {
    const effort = props.reasoningEffort;
    if (props.foreignProvider !== undefined || selectedHasVariants()) return;
    // The effort that the model value fixes is part of the model, also where the effort is not a setting.
    const fixed = selectedFixed()?.effort;
    if (fixed) return reasoningLabel(fixed, t);
    if (!showsReasoningEffort() || !effort) return;
    const model = selectedModel();
    if (!model?.supportedReasoningEfforts.includes(effort) || model.reasoningEffortConfigurable === false) return;
    return reasoningLabel(effort, t);
  };
  /** The account name, only while the agent's provider lists more than one. */
  const triggerAccount = () => {
    if (props.foreignProvider !== undefined) return null;
    const accounts = railAccounts(props.provider);
    if (!accounts.length || (railPool(props.provider) && currentAccount() === null)) return null;
    return providerAccountName(t, accounts, currentAccount() ?? DEFAULT_PROVIDER_ACCOUNT_ID);
  };
  /** The saved speed. It can name a tier that the model does not have. */
  const savedSpeed = (): Speed =>
    props.fastMode !== true ? "standard" : props.ultrafast === true ? "ultrafast" : "fast";
  /**
   * The tier that the next turn uses. A model without a fast tier runs at the standard tier, and
   * Ultrafast on a model without that tier runs at Fast.
   */
  const speed = (): Speed => {
    const model = selectedModel();
    const saved = savedSpeed();
    if (saved === "standard" || !model?.fastServiceTier) return "standard";
    return saved === "ultrafast" && model.ultrafastServiceTier ? "ultrafast" : "fast";
  };
  /** The speed in the trigger, only while the model has the tier: another model runs at standard speed. */
  const triggerSpeed = (): Speed => {
    if (props.foreignProvider !== undefined) return "standard";
    if (selectedFixed()?.fast === true) return "fast";
    return props.onFastModeChange ? speed() : "standard";
  };
  const triggerSpeedName = () => {
    const value = triggerSpeed();
    return value === "standard" ? null : speedName(value, t);
  };
  /**
   * The model name in the trigger. Beside an account it has no provider word, because the mark
   * shows the provider and the account needs the room. The tooltip and the label keep the full name.
   * A form field has the room of its row and keeps the full name.
   */
  const triggerShownName = () => {
    const name = triggerModelName();
    const prefix = `${railName(activeProvider(), t)} `;
    return !field() && triggerAccount() && name.startsWith(prefix) ? name.slice(prefix.length) || name : name;
  };
  /** True while the agent's provider pools its accounts and the agent is not on an API key. */
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
            {/* Keyed by provider, so the mark of a newly chosen provider springs in. */}
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
            // Handled: a form that closes on Escape, such as the new-agent form, stays open.
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
                      // The rail shows a mark alone, so hovering one names it. Focus needs no tooltip:
                      // tabs activate on focus, and the panel heading beside them names the tab.
                      // The name sits to the left, off the panel, and only flips right when the
                      // window edge leaves no room there.
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
                                // An API key bills the key's credit, not the plan of the other accounts,
                                // so its badge is a key, not a number (#5550).
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
                          // Focus leaves the panel before it is hidden from assistive technology.
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
                const [showOlder, setShowOlder] = createSignal(false);
                const olderExpanded = () => (showOlder() ? "true" : "false");
                // An endpoint and a custom agent can both list `goose/default`: match the provider too.
                // Another account of the same provider can list the same models, but not this agent's.
                const selected = createMemo(() =>
                  accountId() !== currentAccount()
                    ? undefined
                    : models().find(
                        (model) =>
                          model.provider === props.provider &&
                          (model.id === props.value || model.variants.some((variant) => variant.id === props.value)),
                      ),
                );
                const selectedKey = () => {
                  const model = selected();
                  return model ? pickerModelKey(model) : props.value;
                };
                // The host folds the models that its default hides under Older models, at the end of
                // the list. A search finds them too, and the selected model stays in the main list.
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
                // OpenCode or Pi and Custom share one wire id; the tab whose list holds it owns it.
                const ownsSelection = () =>
                  provider === CUSTOM_RAIL
                    ? selected()?.provider === props.provider
                    : provider === props.provider &&
                      accountId() === currentAccount() &&
                      (!isCustomProviderHarness(props.provider) || Boolean(selected()));
                /** One list of the rail: the main list, or the older models below the fold row. */
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
                // An account that is not signed in holds back the models its provider serves.
                const modelEnabled = (model: PickerModel) =>
                  modelAvailable(model) && (accountId() === null || available());
                const effortLocked = () => !available();
                /** A spent window that limits every model of the tab: a chip beside the provider name. */
                const headingSpent = createMemo(() => (available() ? entrySpentWindow(key) : undefined));
                const pickerModelOption = (model: PickerModel | undefined) =>
                  model && modelOption(model.provider, model.id);
                /** The model the effort is for: the agent's model, or the one this tab starts on. */
                const effortModel = createMemo(() => {
                  if (ownsSelection()) return selected();
                  const list = main().filter(modelEnabled);
                  return list.find((model) => model.id === railDefaultModel(provider)) ?? list[0];
                });
                const effortOption = () => (ownsSelection() ? selectedModel() : pickerModelOption(effortModel()));
                const effortOptions = createMemo(() => {
                  const variants = effortModel()?.variants ?? [];
                  if (variants.length) return variants;
                  const option = effortOption();
                  return showsReasoningEffort() && option && option.reasoningEffortConfigurable !== false
                    ? option.supportedReasoningEfforts.map((effort) => ({
                        id: effort,
                        name: reasoningLabel(effort, t),
                      }))
                    : [];
                });
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
                  // A model change keeps the agent's effort when the new model has it.
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
                // The provider the tab's status is for: a custom agent has no runtime OpenBot downloads.
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
                  // Downloading outranks connection states; Cancel stops this panel's download.
                  if (runtime()?.phase === "downloading") return "Cancel" as const;
                  if (available() || status().connectionState === "connecting") return undefined;
                  // An account after the first signs in again in Settings, beside its name.
                  if (accountId()) return undefined;
                  if (runtime()?.phase === "ready") return "Connect" as const;
                  if (runtime()?.phase === "download-error") return "Retry" as const;
                  if (runtime()?.phase === "not-downloaded") return "Download" as const;
                  // No runtime snapshot here; signed-out/failed providers offer Connect if handled.
                  if (status().state === "sign-in-required" || status().state === "error") {
                    return props.onConnectProvider && (props.canConnectProvider?.(status().id) ?? true)
                      ? ("Connect" as const)
                      : undefined;
                  }
                  return undefined;
                };
                /** A Connect that failed before the sign-in started. The status reports the rest. */
                const [connectError, setConnectError] = createSignal<string | null>(null);
                const runtimeMessage = () => {
                  const runtimeStatus = runtime();
                  if (runtimeStatus?.phase === "downloading") {
                    return t("provider.picker.downloading", {
                      percent: format.percent(Math.round(runtimeStatus.progress ?? 0) / 100),
                    });
                  }
                  if (runtimeStatus?.phase === "finishing") return t("provider.status.settingUp");
                  // A sign-in in progress has no message. It is not a failure, and nor is a check again.
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
                                  search().trim()
                                    ? t("provider.picker.noMatches")
                                    : // Meta sends a signed-in Muse account an empty list where Muse is not offered (#5983).
                                      provider === "muse"
                                      ? t("provider.picker.museNoModels")
                                      : t("provider.picker.noModels", { name: railName(provider, t) })
                                }
                              >
                                {/* A saved endpoint lists no model until its provider restarts and reads it. */}
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
                          {/* A row of the list, so it takes the look of a model row. */}
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

/**
 * A custom endpoint is an OpenCode endpoint on the wire, whatever tab it is drawn on. Only for what
 * does not depend on the model: a Custom tab choice takes the provider of the model chosen.
 */
/** The list key: a model id alone can repeat across the endpoints and agents of the Custom tab. */
function pickerModelKey(model: PickerModel): string {
  return `${model.provider}:${model.id}`;
}

/** The provider tab of a rail entry. */
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

/** Nothing is the default on the Custom tab: the user's own endpoints have no shipped starting model. */
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
  /** Only when the model has no effort setting of its own. */
  effort: AgentReasoningEffort | null;
  fast: boolean;
}

/**
 * The settings that a Cursor model value fixes, as in `grok-4.7[context=256k,reasoning=high,fast=true]`.
 * Cursor ACP lists one value for each model and refuses the others, so these are not choices (#4411).
 */
function fixedModelSettings(model: ClientAgentModelOption | undefined): FixedModelSettings | null {
  if (model?.provider !== "cursor") return null;
  const params = /\[([^\]]*)\]$/u.exec(model.id)?.[1];
  if (!params) return null;
  const settings: FixedModelSettings = { context: null, effort: null, fast: false };
  for (const pair of params.split(",")) {
    const [key, value = ""] = pair.split("=");
    if (key === "context" && /^\d+(?:\.\d+)?[km]$/iu.test(value)) settings.context = value;
    else if (
      (key === "reasoning" || key === "effort") &&
      model.reasoningEffortConfigurable === false &&
      isReasoningEffort(value)
    )
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

// Constant arrays: a Select that gets a new options array on each change can loop.
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

/** A custom endpoint has no brand mark and must not borrow one, so the rail draws sliders instead. */
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
