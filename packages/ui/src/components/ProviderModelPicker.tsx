import { ProviderLogo } from "@openbot/brand";
import type {
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
  PICKER_PROVIDERS,
  providerDisplayName,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Button,
  Input,
  Listbox,
  Plus,
  Popover,
  Progress,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SlidersHorizontal,
  Switch,
  Tabs,
  Tooltip,
  Zap,
} from "@openbot/ui";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { cx } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { currentText, type TextValue, useText } from "../text";
import { createScrollFades } from "./createScrollFades";
import { providerAccountName } from "./provider-accounts";
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
  /** Fast mode. The picker shows its switch only for a model with a fast tier, and only with `onFastModeChange`. */
  fastMode?: boolean | undefined;
  onFastModeChange?: ((fastMode: boolean) => void) | undefined;
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
   * The agent's provider when this build does not know it. The host still runs the agent, so the
   * picker shows its model, and it cannot open until OpenBot is updated.
   */
  foreignProvider?: ForeignProviderId | undefined;
  /** `accountId` is passed only with `accountChoice`, for a provider with more than one account: null for its own sign-in. */
  onChange: (model: AgentModelId, provider: AgentProviderId, accountId?: string | null) => void;
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

/** The part of the interface text that the provider helpers below read. */
type PickerText = Pick<TextValue, "t" | "sourceText">;

/** The panel button for a provider runtime. The value selects the action; the key is its label. */
const RUNTIME_ACTION_LABEL = {
  Cancel: "common.cancel",
  Connect: "provider.action.connect",
  Retry: "common.retry",
  Download: "common.download",
} as const satisfies Record<string, AppTextKey>;

const REASONING_LABEL = {
  low: "provider.effort.low",
  medium: "provider.effort.medium",
  high: "provider.effort.high",
  xhigh: "provider.effort.xhigh",
  max: "provider.effort.max",
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

/** More effort options than this keep the list: a row of segments gets too narrow. */
const MAX_EFFORT_SEGMENTS = 5;
/**
 * The labels of one segment row, in characters. The five English levels are 26 and just fit the
 * panel width; the five French levels, at 29, do not.
 */
const MAX_EFFORT_SEGMENT_CHARACTERS = 26;

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
  /** The accounts that get rail entries: only a provider's with more than one, and only on request. */
  const railAccounts = (rail: RailId): readonly ProviderAccountStatus[] => {
    if (!props.accountChoice || rail === CUSTOM_RAIL) return [];
    const accounts = props.agentStatus?.providers?.find((status) => status.id === rail)?.accounts ?? [];
    return accounts.length > 1 ? accounts : [];
  };
  const railKeys = createMemo<RailKey[]>(() =>
    visibleProviders().flatMap((rail): RailKey[] => {
      const accounts = railAccounts(rail);
      if (!accounts.length || rail === CUSTOM_RAIL) return [rail];
      return accounts.map((account) =>
        account.id === DEFAULT_PROVIDER_ACCOUNT_ID ? rail : (`${rail}:${account.id}` as const),
      );
    }),
  );
  /** The account for `onChange`: only a provider with account entries sends one. */
  const chosenAccount = (provider: AgentProviderId, accountId: string | null): string | null | undefined =>
    railAccounts(provider).length ? accountId : undefined;
  /** The agent's account when the rail lists it; otherwise the provider's own sign-in. */
  const currentAccount = (): string | null => {
    const id = props.providerAccountId;
    return id && railAccounts(props.provider).some((account) => account.id === id) ? id : null;
  };
  const customIds = createMemo(() => customProviderIds(props.customProviders ?? []));
  const selectedModel = createMemo(() =>
    props.modelOptions.find((option) => option.provider === props.provider && option.id === props.value),
  );
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
  const railSummary = (rail: RailId, status: AgentProviderStatus): string =>
    rail === CUSTOM_RAIL ? customSummary() : providerSummary(rail, status, text);
  const railHeadingSummary = (rail: RailId, status: AgentProviderStatus): string => {
    if (rail !== CUSTOM_RAIL) return providerHeadingSummary(rail, status, text);
    // OpenCode is what serves a custom endpoint, so its trouble is this tab's trouble.
    return status.state === "available" ? customSummary() : providerStatusLabel(status.state, t);
  };

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

  function setPickerOpen(next: boolean): void {
    if (props.disabled) return;
    if (next) {
      setOpenedKeys(untrack(() => railKeys().filter(entryUsable)));
      const key = activeKey();
      setRailProvider(visibleKeys().includes(key) ? key : (visibleKeys()[0] ?? CUSTOM_RAIL));
      setSearch("");
    }
    setOpen(next);
  }

  function selectModel(option: PickerModel, accountId: string | null): void {
    if (props.disabled || !modelAvailable(option)) return;
    if (!showsReasoningEffort() && !option.variants.length) setOpen(false);
    props.onChange(option.id, option.provider, chosenAccount(option.provider, accountId));
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
    if (props.foreignProvider !== undefined || !showsReasoningEffort() || !effort || selectedHasVariants()) return;
    const model = selectedModel();
    if (!model?.supportedReasoningEfforts.includes(effort) || model.reasoningEffortConfigurable === false) return;
    return reasoningLabel(effort, t);
  };
  /** The account name, only while the agent's provider lists more than one. */
  const triggerAccount = () => {
    if (props.foreignProvider !== undefined) return null;
    const accounts = railAccounts(props.provider);
    return accounts.length ? providerAccountName(t, accounts, currentAccount() ?? DEFAULT_PROVIDER_ACCOUNT_ID) : null;
  };
  /** Fast mode, only while the model has a fast tier: another model runs at standard speed. */
  const triggerFast = () =>
    props.foreignProvider === undefined &&
    props.fastMode === true &&
    props.onFastModeChange !== undefined &&
    Boolean(selectedModel()?.fastServiceTier);
  const triggerSummary = () =>
    [triggerModelName(), triggerEffort(), triggerFast() ? t("provider.picker.fast") : null, triggerAccount()]
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
            <SwapLabel class="provider-model-trigger-name" text={triggerModelName()} motion={TRIGGER_SWAP} />
            <Show when={triggerEffort()}>
              {(effort) => (
                <span class="provider-model-trigger-effort">
                  <SwapLabel text={effort()} motion={TRIGGER_SWAP} />
                </span>
              )}
            </Show>
            <Show when={triggerFast()}>
              <span class="provider-model-trigger-effort provider-model-trigger-fast">
                <Zap aria-hidden="true" />
                <SwapLabel text={t("provider.picker.fast")} motion={TRIGGER_SWAP} />
              </span>
            </Show>
            <Show when={triggerAccount()}>
              {(account) => (
                <span class="provider-model-trigger-effort provider-model-trigger-account">
                  <SwapLabel text={account()} motion={TRIGGER_SWAP} />
                </span>
              )}
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
                            aria-label={`${name()}: ${railSummary(provider, status())}`}
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
                                  {entry().number}
                                </span>
                              )}
                            </Show>
                          </Tabs.Trigger>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content class="provider-model-rail-tooltip">
                            <strong>{name()}</strong>
                            <small>{railSummary(provider, status())}</small>
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
                const models = createMemo(() => pickerModels(railModelOptions(provider)));
                const groups = createMemo(() => groupPickerModels(models(), search()));
                // An endpoint and a custom agent can both list `goose/default`: match the provider too.
                // Another account of the same provider lists the same models, but not this agent's.
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
                // OpenCode or Pi and Custom share one wire id; the tab whose list holds it owns it.
                const ownsSelection = () =>
                  provider === CUSTOM_RAIL
                    ? selected()?.provider === props.provider
                    : provider === props.provider &&
                      accountId() === currentAccount() &&
                      (!isCustomProviderHarness(props.provider) || Boolean(selected()));
                const effortOptions = createMemo(() => {
                  if (!ownsSelection()) return [];
                  if (selected()?.variants.length) return selected()?.variants ?? [];
                  return showsReasoningEffort() && selectedModel()?.reasoningEffortConfigurable !== false
                    ? (selectedModel()?.supportedReasoningEfforts ?? []).map((effort) => ({
                        id: effort,
                        name: reasoningLabel(effort, t),
                      }))
                    : [];
                });
                const effortValue = () => (selected()?.variants.length ? props.value : props.reasoningEffort);
                const fades = createScrollFades();
                onSettled(() => fades.stop);
                createEffect(
                  () => ({ groups: groups(), active: railProvider(), open: open() }),
                  () => fades.remeasure(),
                );
                const available = () => status().state === "available";
                // An account that is not signed in holds back the models its provider serves.
                const modelEnabled = (model: PickerModel) =>
                  modelAvailable(model) && (accountId() === null || available());
                const effortLocked = () => !available();
                function chooseEffort(id: string): void {
                  if (props.disabled || effortLocked() || id === effortValue()) return;
                  const model = selected();
                  if (model?.variants.length)
                    props.onChange(id, model.provider, chosenAccount(model.provider, accountId()));
                  else {
                    const effort = selectedModel()?.supportedReasoningEfforts.find((effort) => effort === id);
                    if (effort) props.onReasoningEffortChange?.(effort);
                  }
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
                      <div class="provider-model-heading-text">
                        <strong>{entryName(key)}</strong>
                        <span>
                          {account() && status().state === "available"
                            ? (account()?.account.email ?? railHeadingSummary(provider, status()))
                            : railHeadingSummary(provider, status())}
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
                                    : t("provider.picker.noModels", { name: railName(provider, t) })
                                }
                              >
                                <span>{t("provider.picker.customEmpty")}</span>
                              </Show>
                            </div>
                          </Show>
                        }
                      >
                        <Listbox.Root<PickerModel, PickerModelGroup>
                          class="provider-model-list"
                          aria-label={t("provider.picker.models", { name: railName(provider, t) })}
                          options={groups()}
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
                            return (
                              <Listbox.Item
                                as="button"
                                item={item}
                                type="button"
                                class={["provider-model-option", { "provider-model-option-selected": isSelected() }]}
                                aria-label={
                                  model.id === railDefaultModel(provider)
                                    ? t("provider.picker.defaultModelLabel", {
                                        name: displayModelName(model.name, model.id),
                                      })
                                    : displayModelName(model.name, model.id)
                                }
                                disabled={!modelEnabled(model)}
                                onClick={() => {
                                  if (!isSelected()) selectModel(model, accountId());
                                }}
                              >
                                <span class="provider-model-option-name">
                                  <span>{displayModelName(model.name, model.id)}</span>
                                  <Show when={model.free}>
                                    <small>{t("provider.model.free")}</small>
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
                      </Show>
                    </div>
                    <Show when={effortOptions().length > 0}>
                      <div class="provider-model-effort">
                        <span>{t("provider.picker.effort")}</span>
                        <Show
                          when={
                            effortOptions().length <= MAX_EFFORT_SEGMENTS &&
                            effortOptions().reduce((length, option) => length + option.name.length, 0) <=
                              MAX_EFFORT_SEGMENT_CHARACTERS
                          }
                          fallback={
                            <Select<{ id: string; name: string }>
                              class="provider-model-effort-select"
                              options={effortOptions()}
                              optionValue="id"
                              optionTextValue="name"
                              value={effortOptions().find((option) => option.id === effortValue())}
                              onChange={(option) => option && chooseEffort(option.id)}
                              itemComponent={(item) => (
                                <SelectItem item={item.item}>{item.item.rawValue.name}</SelectItem>
                              )}
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
                          }
                        >
                          <EffortSegments
                            label={t("provider.picker.effortLabel")}
                            options={effortOptions()}
                            value={effortValue()}
                            disabled={effortLocked()}
                            onChange={chooseEffort}
                          />
                        </Show>
                      </div>
                    </Show>
                    <Show when={ownsSelection() && selectedModel()?.fastServiceTier && props.onFastModeChange}>
                      <div class="provider-model-effort">
                        <span>{t("provider.picker.fast")}</span>
                        <Switch
                          aria-label={t("provider.picker.fastLabel")}
                          checked={props.fastMode === true}
                          disabled={props.disabled || effortLocked()}
                          onChange={(next) => props.onFastModeChange?.(next)}
                        />
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

export function reasoningLabel(effort: AgentReasoningEffort, t: AppTranslate = currentText().t): string {
  return t(REASONING_LABEL[effort]);
}

interface EffortOption {
  id: string;
  name: string;
}

/**
 * Effort as a radio group of segments. The chosen segment has a pill under it that slides to a new
 * choice, with the SlidingTabs timing. SlidingTabs itself is a tab list; this is a choice of value.
 */
function EffortSegments(props: {
  label: string;
  options: readonly EffortOption[];
  value: string | undefined;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  let group: HTMLElement | undefined;
  let pill: HTMLSpanElement | undefined;
  let chosen = -1;
  let placed = false;

  /** The first placement and a resize put the pill in place at once; a new choice slides it. */
  function placePill(slide: boolean): void {
    if (!group || !pill) return;
    const control = group.querySelectorAll<HTMLElement>(".provider-model-effort-segment-control")[chosen];
    pill.hidden = !control;
    if (!control) return;
    const still = !slide || !placed;
    if (still) pill.dataset.initializing = "";
    pill.style.width = `${control.offsetWidth}px`;
    pill.style.transform = `translateX(${control.offsetLeft}px)`;
    if (still) {
      pill.getBoundingClientRect();
      delete pill.dataset.initializing;
    }
    placed = true;
  }

  createEffect(
    () => props.options.findIndex((option) => option.id === props.value),
    (index) => {
      chosen = index;
      placePill(true);
    },
  );
  const resize = new ResizeObserver(() => placePill(false));
  onCleanup(() => resize.disconnect());

  return (
    <RadioGroup.Root
      ref={(element: HTMLElement) => {
        group = element;
        resize.observe(element);
      }}
      class="provider-model-effort-segments"
      aria-label={props.label}
      orientation="horizontal"
      value={props.value ?? ""}
      disabled={props.disabled}
      onChange={props.onChange}
    >
      <span ref={pill} class="provider-model-effort-pill" aria-hidden="true" />
      {/* Keyed by id: the options are new objects when the effort changes, and a new radio would
          take the keyboard focus away. */}
      <For each={props.options} keyed={(option) => option.id}>
        {(option) => {
          // A new label changes the segment widths without a new choice, so each segment is watched.
          let control: HTMLElement | undefined;
          onCleanup(() => control && resize.unobserve(control));
          return (
            <RadioGroup.Item class="provider-model-effort-segment" value={option().id}>
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl
                ref={(element: HTMLElement) => {
                  control = element;
                  resize.observe(element);
                }}
                class="provider-model-effort-segment-control"
              >
                <RadioGroup.ItemLabel>{option().name}</RadioGroup.ItemLabel>
              </RadioGroup.ItemControl>
            </RadioGroup.Item>
          );
        }}
      </For>
    </RadioGroup.Root>
  );
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
