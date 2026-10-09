import { ProviderLogo } from "@openbot/brand";
import type {
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentProviderStatus,
  AgentReasoningEffort,
  AgentStatus,
  CustomAgentSummary,
  CustomProviderSummary,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import {
  agentProviderCliName,
  agentProviderName,
  customAgentIdOfModel,
  defaultProviderModel,
  isCustomProviderModelId,
  PICKER_PROVIDERS,
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
} from "@openbot/ui";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { cx } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { currentText, type TextValue, useText } from "../text";
import { createScrollFades } from "./createScrollFades";
import {
  customProviderIds,
  groupPickerModels,
  isCustomModel,
  type PickerModel,
  type PickerModelGroup,
  pickerModels,
} from "./provider-model-options";
import { StandingApprovalConfirmation } from "./StandingApprovalConfirmation";
import { SwapLabel, type SwapMotion } from "./SwapLabel";

interface ProviderModelPickerProps {
  provider: AgentProviderId;
  value: AgentModelId;
  modelOptions: AgentModelOption[];
  agentStatus: AgentStatus;
  variant?: "pill" | "field";
  ariaLabel?: string;
  label?: string;
  /** A glyph before the field label. The `field` variant only. */
  icon?: JSX.Element;
  reasoningEffort?: AgentReasoningEffort;
  onReasoningEffortChange?: (effort: AgentReasoningEffort) => void;
  disabled?: boolean;
  /** Keep approval controls available while model and effort changes are locked. */
  modelChangesDisabled?: boolean;
  disabledReason?: string;
  runtimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>>;
  onDownloadProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onCancelProviderDownload?: (provider: AgentProviderId) => void | Promise<void>;
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>;
  /** Endpoints the user named; served by OpenCode, separated out only by the picker. */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** The user's own ACP agents; provider `acp`, drawn on the Custom tab with one group each. */
  customAgents?: readonly CustomAgentSummary[] | undefined;
  /** Receives the picker trigger, so focus returns to it when the opened settings close. */
  onAddCustomProvider?: (trigger: HTMLElement) => void;
  /**
   * This agent's standing approval, below Effort. Without the callback the row is absent, which is
   * how a remote agent and the setup screen show the picker they always showed: the grant belongs
   * to the computer that runs the agent.
   */
  autoApprove?: boolean;
  agentName?: string;
  /** Turbo mode already covers every agent, so the switch reads on and cannot be turned off here. */
  autoApproveLocked?: boolean;
  onAutoApproveChange?: (autoApprove: boolean) => void;
  onChange: (model: AgentModelId, provider: AgentProviderId) => void;
}

/** Extra "custom" rail tab; widening the contract id would cost a migration. */
type RailId = AgentProviderId | "custom";

const CUSTOM_RAIL = "custom" as const;

const PROVIDERS: readonly RailId[] = [...PICKER_PROVIDERS, CUSTOM_RAIL];

/** Long enough that sweeping the rail does not flash a name per mark. */
const RAIL_TOOLTIP_OPEN_DELAY = 150;

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
  const [grantConfirmation, setGrantConfirmation] = createSignal<{ name?: string; confirm: () => void } | null>(null);
  let trigger: HTMLButtonElement | undefined;
  const providerButtons = new Map<RailId, HTMLButtonElement>();
  let root: HTMLDivElement | undefined;
  let popover: HTMLElement | undefined;

  const visibleProviders = createMemo(() =>
    PROVIDERS.filter(
      (provider) => !props.agentStatus?.providers?.some((status) => status.id === provider && status.off),
    ),
  );
  const customIds = createMemo(() => customProviderIds(props.customProviders ?? []));
  const selectedModel = createMemo(() =>
    props.modelOptions.find((option) => option.provider === props.provider && option.id === props.value),
  );
  /** The tab the current selection lives on: the Custom one for the user's endpoints and agents. */
  const activeProvider = (): RailId =>
    props.provider === "acp" || (props.provider === "opencode" && isCustomProviderModelId(props.value, customIds()))
      ? CUSTOM_RAIL
      : props.provider;
  const [railProvider, setRailProvider] = createSignal<RailId>(untrack(activeProvider));
  /** The provider whose mark the trigger shows, so only a changed one springs in. */
  let shownProvider = untrack(activeProvider);

  /** OpenCode and Custom tabs split one wire provider so each model appears once. */
  function railModelOptions(rail: RailId): AgentModelOption[] {
    if (rail === CUSTOM_RAIL) return props.modelOptions.filter((option) => isCustomModel(option, customIds()));
    if (rail === "opencode") {
      return props.modelOptions.filter(
        (option) => option.provider === "opencode" && !isCustomModel(option, customIds()),
      );
    }
    return props.modelOptions.filter((option) => option.provider === rail);
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
  /**
   * One provider status per tab. The Custom tab stands for OpenCode, which serves the endpoints, and
   * for `acp`, which runs the agents: it is available when either of the saved kinds is.
   */
  const railStatus = (rail: RailId): AgentProviderStatus => {
    if (rail !== CUSTOM_RAIL) return providerAvailability(props.agentStatus, props.modelOptions, rail, t);
    const endpoints = providerAvailability(props.agentStatus, props.modelOptions, "opencode", t);
    if (agentCount() === 0) return endpoints;
    const agents = providerAvailability(props.agentStatus, props.modelOptions, "acp", t);
    if (!props.customProviders?.length) return agents;
    return endpoints.state === "available" || agents.state !== "available" ? endpoints : agents;
  };
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
    () => ({ provider: activeProvider(), open: open(), visible: visibleProviders(), rail: railProvider() }),
    ({ provider, open, visible, rail }) => {
      if (!open || !visible.includes(rail))
        setRailProvider(visible.includes(provider) ? provider : (visible[0] ?? CUSTOM_RAIL));
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
      const provider = activeProvider();
      setRailProvider(visibleProviders().includes(provider) ? provider : (visibleProviders()[0] ?? CUSTOM_RAIL));
      setSearch("");
    }
    setOpen(next);
  }

  function selectModel(option: PickerModel): void {
    if (props.disabled || props.modelChangesDisabled || !modelAvailable(option)) return;
    if (!showsReasoningEffort() && !option.variants.length) setOpen(false);
    props.onChange(option.id, option.provider);
  }

  function selectRailProvider(provider: RailId): void {
    setRailProvider(provider);
    setSearch("");
  }

  const triggerModelName = () => displayModelName(selectedModel()?.name, props.value);
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
    if (!showsReasoningEffort() || !effort || selectedHasVariants()) return;
    const model = selectedModel();
    if (!model?.supportedReasoningEfforts.includes(effort) || model.reasoningEffortConfigurable === false) return;
    return reasoningLabel(effort, t);
  };
  const triggerSummary = () => [triggerModelName(), triggerEffort()].filter(Boolean).join(" · ");

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
          disabled={props.disabled}
          title={
            props.disabled || props.modelChangesDisabled
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
                    <ProviderMark provider={provider()} />
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
          </span>
          <ChevronDownIcon />
        </Popover.Trigger>

        <Popover.Content
          ref={(element) => (popover = element)}
          class="provider-model-popover"
          aria-hidden={open() ? undefined : "true"}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <ContentExitMotion panel={() => popover} />
          <Popover.Title class="sr-only">{t("provider.picker.title")}</Popover.Title>
          <Tabs.Root
            value={railProvider()}
            onChange={(value) => {
              const provider = visibleProviders().find((candidate) => candidate === value);
              if (provider) selectRailProvider(provider);
            }}
            orientation="vertical"
            activationMode="automatic"
            class="provider-model-layout"
          >
            <Tabs.List class="provider-model-rail" aria-label={t("provider.picker.providers")}>
              <For each={visibleProviders()}>
                {(provider) => {
                  const status = () => railStatus(provider);
                  return (
                    // The rail shows a mark alone, so hovering one names it. Focus needs no tooltip:
                    // tabs activate on focus, and the panel heading beside them names the tab.
                    // The name sits to the left, off the panel, and only flips right when the
                    // window edge leaves no room there.
                    <Tooltip.Root
                      placement="left"
                      gutter={8}
                      openDelay={RAIL_TOOLTIP_OPEN_DELAY}
                      closeDelay={0}
                      skipDelayDuration={300}
                    >
                      <Tooltip.Trigger as="div" class="provider-model-rail-tooltip-trigger">
                        <Tabs.Trigger
                          ref={(element) => providerButtons.set(provider, element)}
                          value={provider}
                          class={[
                            "provider-model-rail-button",
                            {
                              "provider-model-rail-button-selected": railProvider() === provider,
                              "provider-model-rail-button-unavailable": status().state !== "available",
                            },
                          ]}
                          data-state={status().state}
                          aria-label={`${railName(provider, t)}: ${railSummary(provider, status())}`}
                          onClick={(event) => {
                            const target = event.currentTarget;
                            selectRailProvider(provider);
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
                            const providers = visibleProviders();
                            const current = providers.indexOf(provider);
                            const next = providers[(current + delta + providers.length) % providers.length];
                            if (next) providerButtons.get(next)?.focus();
                          }}
                        >
                          <ProviderMark provider={provider} large />
                        </Tabs.Trigger>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content class="provider-model-rail-tooltip">
                          <strong>{railName(provider, t)}</strong>
                          <small>{railSummary(provider, status())}</small>
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  );
                }}
              </For>
            </Tabs.List>

            <For each={visibleProviders()}>
              {(provider) => {
                const status = () => railStatus(provider);
                const models = createMemo(() => pickerModels(railModelOptions(provider)));
                const groups = createMemo(() => groupPickerModels(models(), search()));
                // An endpoint and a custom agent can both list `goose/default`: match the provider too.
                const selected = createMemo(() =>
                  models().find(
                    (model) =>
                      model.provider === props.provider &&
                      (model.id === props.value || model.variants.some((variant) => variant.id === props.value)),
                  ),
                );
                const selectedKey = () => {
                  const model = selected();
                  return model ? pickerModelKey(model) : props.value;
                };
                // OpenCode and Custom share the `opencode` wire id; the tab whose list holds it owns it.
                const ownsSelection = () =>
                  provider === CUSTOM_RAIL
                    ? selected()?.provider === props.provider
                    : provider === props.provider && (props.provider !== "opencode" || Boolean(selected()));
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
                const effortLocked = () => !available() || props.modelChangesDisabled === true;
                function chooseEffort(id: string): void {
                  if (props.disabled || effortLocked() || id === effortValue()) return;
                  const model = selected();
                  if (model?.variants.length) props.onChange(id, model.provider);
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
                  if (runtime()?.phase === "ready") return "Connect" as const;
                  if (runtime()?.phase === "download-error") return "Retry" as const;
                  if (runtime()?.phase === "not-downloaded") return "Download" as const;
                  // No runtime snapshot here; signed-out/failed providers offer Connect if handled.
                  if (status().state === "sign-in-required" || status().state === "error") {
                    return props.onConnectProvider ? ("Connect" as const) : undefined;
                  }
                  return undefined;
                };
                const runtimeMessage = () => {
                  const runtimeStatus = runtime();
                  if (runtimeStatus?.phase === "downloading") {
                    return t("provider.picker.downloading", {
                      percent: format.percent(Math.round(runtimeStatus.progress ?? 0) / 100),
                    });
                  }
                  if (runtimeStatus?.phase === "finishing") return t("provider.status.settingUp");
                  const message = runtimeStatus?.message ?? status().message;
                  return message
                    ? text.sourceText(message)
                    : t("provider.picker.unavailable", { name: railName(provider, t) });
                };
                return (
                  <Tabs.Content
                    value={provider}
                    class="provider-model-panel"
                    aria-label={t("provider.picker.models", { name: railName(provider, t) })}
                  >
                    <div class="provider-model-heading">
                      <div class="provider-model-heading-text">
                        <strong>{railName(provider, t)}</strong>
                        <span>{railHeadingSummary(provider, status())}</span>
                      </div>
                      <Show when={provider === CUSTOM_RAIL && props.onAddCustomProvider}>
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
                                else if (action() === "Connect") void props.onConnectProvider?.(target);
                                else void props.onDownloadProvider?.(target);
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
                          optionDisabled={(model) => !modelAvailable(model) || props.modelChangesDisabled === true}
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
                                disabled={!modelAvailable(model) || props.modelChangesDisabled}
                                onClick={() => {
                                  if (!isSelected()) selectModel(model);
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
                    <Show when={props.onAutoApproveChange}>
                      {(change) => (
                        <div class="provider-model-effort">
                          <span>{t("provider.picker.autoApprove")}</span>
                          <Switch
                            aria-label={t("provider.picker.autoApproveLabel")}
                            checked={props.autoApprove === true}
                            disabled={props.autoApproveLocked === true}
                            onChange={(next) => {
                              const save = change();
                              if (!next) return save(false);
                              setGrantConfirmation({ name: props.agentName, confirm: () => save(true) });
                              setOpen(false);
                            }}
                          />
                        </div>
                      )}
                    </Show>
                  </Tabs.Content>
                );
              }}
            </For>
          </Tabs.Root>
        </Popover.Content>
      </Popover.Root>
      <StandingApprovalConfirmation
        open={grantConfirmation() !== null}
        agentName={grantConfirmation()?.name}
        restoreFocusTarget={trigger}
        onCancel={() => setGrantConfirmation(null)}
        onConfirm={() => {
          const grant = grantConfirmation();
          setGrantConfirmation(null);
          grant?.confirm();
        }}
      />
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

function providerAvailability(
  status: AgentStatus,
  models: AgentModelOption[],
  rail: RailId,
  t: AppTranslate,
): AgentProviderStatus {
  const provider = wireProvider(rail);
  const explicit = status.providers?.find((item) => item.id === provider);
  if (explicit) return explicit;
  if (status.phase === "starting" || status.phase === "restarting") {
    return { id: provider, state: "checking", version: null, message: null };
  }
  const available = models.some((model) => model.provider === provider);
  return {
    id: provider,
    state: available ? "available" : "error",
    version: null,
    message: available ? null : t("provider.picker.unavailable", { name: agentProviderName(provider) }),
  };
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
