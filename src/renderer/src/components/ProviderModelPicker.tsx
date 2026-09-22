import { ProviderLogo } from "@openbot/brand";
import type {
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentProviderStatus,
  AgentReasoningEffort,
  AgentStatus,
  CustomProviderSummary,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import {
  agentProviderCliName,
  agentProviderName,
  defaultProviderModel,
  isCustomProviderModelId,
  PICKER_PROVIDERS,
} from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
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
import {
  Button,
  Input,
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
  Switch,
  Tabs,
  Tooltip,
} from "./ui";
import { cx } from "./ui/utils";

interface ProviderModelPickerProps {
  provider: AgentProviderId;
  value: AgentModelId;
  modelOptions: AgentModelOption[];
  agentStatus: AgentStatus;
  variant?: "pill" | "field";
  ariaLabel?: string;
  label?: string;
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
  customProviders?: readonly CustomProviderSummary[];
  onAddCustomProvider?: () => void;
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

export function ProviderModelPicker(props: ProviderModelPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [grantConfirmation, setGrantConfirmation] = createSignal<{ name?: string; confirm: () => void } | null>(null);
  let trigger: HTMLButtonElement | undefined;
  const providerButtons = new Map<RailId, HTMLButtonElement>();
  let root: HTMLDivElement | undefined;

  const customIds = createMemo(() => customProviderIds(props.customProviders ?? []));
  const selectedModel = createMemo(() =>
    props.modelOptions.find((option) => option.provider === props.provider && option.id === props.value),
  );
  /** The tab the current selection lives on, which is the Custom one when the endpoint is the user's. */
  const activeProvider = (): RailId =>
    props.provider === "opencode" && isCustomProviderModelId(props.value, customIds()) ? CUSTOM_RAIL : props.provider;
  const [railProvider, setRailProvider] = createSignal<RailId>(untrack(activeProvider));

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

  const customSummary = () => {
    const count = props.customProviders?.length ?? 0;
    if (count === 0) return "No endpoints yet";
    return count === 1 ? "1 endpoint" : `${count} endpoints`;
  };
  const railSummary = (rail: RailId, status: AgentProviderStatus): string =>
    rail === CUSTOM_RAIL ? customSummary() : providerSummary(rail, status);
  const railHeadingSummary = (rail: RailId, status: AgentProviderStatus): string => {
    if (rail !== CUSTOM_RAIL) return providerHeadingSummary(rail, status);
    // OpenCode is what serves a custom endpoint, so its trouble is this tab's trouble.
    return status.state === "available" ? customSummary() : providerStatusLabel(status.state);
  };

  createEffect(
    () => ({ provider: activeProvider(), open: open() }),
    ({ provider, open }) => {
      if (!open) setRailProvider(provider);
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
      setRailProvider(activeProvider());
      setSearch("");
    }
    setOpen(next);
  }

  function selectModel(model: AgentModelId, rail: RailId): void {
    if (props.disabled || props.modelChangesDisabled) return;
    if (providerAvailability(props.agentStatus, props.modelOptions, rail).state !== "available") return;
    if (
      !showsReasoningEffort() &&
      !pickerModels(railModelOptions(rail)).find((option) => option.id === model)?.variants.length
    )
      setOpen(false);
    props.onChange(model, wireProvider(rail));
  }

  function selectRailProvider(provider: RailId): void {
    setRailProvider(provider);
    setSearch("");
  }

  const triggerModelName = () => displayModelName(selectedModel()?.name, props.value);
  const field = () => props.variant === "field";
  const showsReasoningEffort = () => props.reasoningEffort !== undefined && props.onReasoningEffortChange !== undefined;

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
          aria-label={`${props.ariaLabel ?? "Agent model"}: ${triggerModelName()}`}
          disabled={props.disabled}
          title={
            props.disabled || props.modelChangesDisabled
              ? props.disabledReason
              : `${railName(activeProvider())} · ${triggerModelName()}`
          }
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            setPickerOpen(true);
          }}
        >
          <Show when={field()}>
            <span class="provider-model-field-label">{props.label ?? "Model"}</span>
          </Show>
          <span class="provider-model-trigger-value">
            <ProviderMark provider={activeProvider()} />
            <span class="provider-model-trigger-name">{triggerModelName()}</span>
          </span>
          <ChevronDownIcon />
        </Popover.Trigger>

        <Popover.Content
          class="provider-model-popover"
          aria-hidden={open() ? undefined : "true"}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <Popover.Title class="sr-only">Choose agent model</Popover.Title>
          <Tabs.Root
            value={railProvider()}
            onChange={(value) => {
              const provider = PROVIDERS.find((candidate) => candidate === value);
              if (provider) selectRailProvider(provider);
            }}
            orientation="vertical"
            activationMode="automatic"
            class="provider-model-layout"
          >
            <Tabs.List class="provider-model-rail" aria-label="Model providers">
              <For each={PROVIDERS}>
                {(provider) => {
                  const status = () => providerAvailability(props.agentStatus, props.modelOptions, provider);
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
                          aria-label={`${railName(provider)}: ${railSummary(provider, status())}`}
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
                            const current = PROVIDERS.indexOf(provider);
                            const next = PROVIDERS[(current + delta + PROVIDERS.length) % PROVIDERS.length];
                            if (next) providerButtons.get(next)?.focus();
                          }}
                        >
                          <ProviderMark provider={provider} large />
                        </Tabs.Trigger>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content class="provider-model-rail-tooltip">
                          <strong>{railName(provider)}</strong>
                          <small>{railSummary(provider, status())}</small>
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  );
                }}
              </For>
            </Tabs.List>

            <For each={PROVIDERS}>
              {(provider) => {
                const status = () => providerAvailability(props.agentStatus, props.modelOptions, provider);
                const models = createMemo(() => pickerModels(railModelOptions(provider)));
                const groups = createMemo(() => groupPickerModels(models(), search()));
                const selected = createMemo(() =>
                  models().find(
                    (model) => model.id === props.value || model.variants.some((variant) => variant.id === props.value),
                  ),
                );
                // Both tabs share the `opencode` wire id; the tab whose list holds it owns it.
                const ownsSelection = () =>
                  wireProvider(provider) === props.provider && (props.provider !== "opencode" || Boolean(selected()));
                const effortOptions = createMemo(() => {
                  if (!ownsSelection()) return [];
                  if (selected()?.variants.length) return selected()?.variants ?? [];
                  return showsReasoningEffort()
                    ? (selectedModel()?.supportedReasoningEfforts ?? []).map((effort) => ({
                        id: effort,
                        name: reasoningLabel(effort),
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
                const runtime = () => {
                  const value = props.runtimeStatuses?.[wireProvider(provider)];
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
                    return `Downloading ${Math.round(runtimeStatus.progress ?? 0)}%`;
                  }
                  if (runtimeStatus?.phase === "finishing") return "Setting up";
                  return runtimeStatus?.message ?? status().message ?? `${railName(provider)} is unavailable.`;
                };
                return (
                  <Tabs.Content
                    value={provider}
                    class="provider-model-panel"
                    aria-label={`${railName(provider)} models`}
                  >
                    <div class="provider-model-heading">
                      <div class="provider-model-heading-text">
                        <strong>{railName(provider)}</strong>
                        <span>{railHeadingSummary(provider, status())}</span>
                      </div>
                      <Show when={provider === CUSTOM_RAIL && props.onAddCustomProvider}>
                        <Button type="button" size="xs" variant="default" onClick={() => props.onAddCustomProvider?.()}>
                          <Plus />
                          Add provider
                        </Button>
                      </Show>
                    </div>
                    <Show when={!available()}>
                      <div class="provider-model-empty" role="status">
                        <span>{runtimeMessage()}</span>
                        <Show when={runtime()?.phase === "downloading"}>
                          <Progress value={runtime()?.progress ?? 0} aria-label={`${railName(provider)} download`} />
                        </Show>
                        <Show when={runtimeAction()}>
                          {(action) => (
                            <Button
                              type="button"
                              size="xs"
                              variant={action() === "Download" ? "default" : "outline"}
                              onClick={() => {
                                const target = wireProvider(provider);
                                if (action() === "Cancel") void props.onCancelProviderDownload?.(target);
                                else if (action() === "Connect") void props.onConnectProvider?.(target);
                                else void props.onDownloadProvider?.(target);
                              }}
                            >
                              {action()}
                            </Button>
                          )}
                        </Show>
                      </div>
                    </Show>
                    <Input
                      class="provider-model-search"
                      aria-label="Search models"
                      placeholder="Search models"
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
                                    ? "No models match your search."
                                    : `No models are available from ${railName(provider)}.`
                                }
                              >
                                <span>
                                  Add an OpenAI-compatible endpoint — a model server on this computer, or any service
                                  with a base URL and a key.
                                </span>
                              </Show>
                            </div>
                          </Show>
                        }
                      >
                        <Listbox.Root<PickerModel, PickerModelGroup>
                          class="provider-model-list"
                          aria-label={`${railName(provider)} models`}
                          options={groups()}
                          optionGroupChildren="models"
                          renderSection={(section) => (
                            <Show when={section.rawValue.name}>
                              <Listbox.Section class="provider-model-group">{section.rawValue.name}</Listbox.Section>
                            </Show>
                          )}
                          optionValue="id"
                          optionTextValue={(model) => displayModelName(model.name, model.id)}
                          optionDisabled={() => !available() || props.modelChangesDisabled === true}
                          value={[selected()?.id ?? props.value]}
                          selectionMode="single"
                          disallowEmptySelection
                          shouldFocusWrap
                          renderItem={(item) => {
                            const model = item.rawValue;
                            const isSelected = () => selected()?.id === model.id;
                            return (
                              <Listbox.Item
                                as="button"
                                item={item}
                                type="button"
                                class={["provider-model-option", { "provider-model-option-selected": isSelected() }]}
                                aria-label={`${displayModelName(model.name, model.id)}${
                                  model.id === railDefaultModel(provider) ? ", default" : ""
                                }`}
                                disabled={!available() || props.modelChangesDisabled}
                                onClick={() => {
                                  if (!isSelected() || props.provider !== provider) selectModel(model.id, provider);
                                }}
                              >
                                <span class="provider-model-option-name">
                                  <span>{displayModelName(model.name, model.id)}</span>
                                  <Show when={model.free}>
                                    <small>Free</small>
                                  </Show>
                                  <Show when={model.id === railDefaultModel(provider)}>
                                    <small>default</small>
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
                        <span>Effort</span>
                        <Select<{ id: string; name: string }>
                          class="provider-model-effort-select"
                          options={effortOptions()}
                          optionValue="id"
                          optionTextValue="name"
                          value={effortOptions().find((option) => option.id === effortValue())}
                          onChange={(option) => {
                            if (
                              props.disabled ||
                              props.modelChangesDisabled ||
                              !available() ||
                              !option ||
                              option.id === effortValue()
                            )
                              return;
                            if (selected()?.variants.length) props.onChange(option.id, wireProvider(provider));
                            else {
                              const effort = selectedModel()?.supportedReasoningEfforts.find(
                                (effort) => effort === option.id,
                              );
                              if (effort) props.onReasoningEffortChange?.(effort);
                            }
                          }}
                          itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.name}</SelectItem>}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label="Agent reasoning effort"
                            disabled={!available() || props.modelChangesDisabled}
                          >
                            <SelectValue<{ id: string; name: string }>>
                              {(state) => state.selectedOption()?.name ?? "Select effort"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent class="provider-model-effort-content" />
                        </Select>
                      </div>
                    </Show>
                    <Show when={props.onAutoApproveChange}>
                      {(change) => (
                        <div class="provider-model-effort">
                          <span>Auto approve</span>
                          <Switch
                            size="sm"
                            aria-label="Auto approve this agent's actions"
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

/** A custom endpoint is an OpenCode endpoint on the wire, whatever tab it is drawn on. */
function wireProvider(rail: RailId): AgentProviderId {
  return rail === CUSTOM_RAIL ? "opencode" : rail;
}

function railName(rail: RailId): string {
  return rail === CUSTOM_RAIL ? "Custom" : agentProviderName(rail);
}

/** Nothing is the default on the Custom tab: the user's own endpoints have no shipped starting model. */
function railDefaultModel(rail: RailId): AgentModelId | null {
  return rail === CUSTOM_RAIL ? null : defaultProviderModel(rail);
}

function providerAvailability(status: AgentStatus, models: AgentModelOption[], rail: RailId): AgentProviderStatus {
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
    message: available ? null : `${agentProviderName(provider)} is unavailable.`,
  };
}

function providerSummary(provider: AgentProviderId, status: AgentProviderStatus): string {
  if (status.state === "available") {
    return status.version
      ? `${status.version} (${agentProviderCliName(provider)})`
      : `${agentProviderCliName(provider)} ready`;
  }
  return status.message ?? providerStatusLabel(status.state);
}

function providerHeadingSummary(provider: AgentProviderId, status: AgentProviderStatus): string {
  if (status.state === "available") return providerSummary(provider, status);
  return providerStatusLabel(status.state);
}

function providerStatusLabel(
  state: AgentProviderStatus["state"],
): "Sign in required" | "Not installed" | "Update required" | "Unavailable" | "Checking" {
  if (state === "sign-in-required") return "Sign in required";
  if (state === "not-installed") return "Not installed";
  if (state === "outdated") return "Update required";
  if (state === "error") return "Unavailable";
  return "Checking";
}

function displayModelName(name: string | undefined, fallback: string): string {
  return name?.replace(/^[\s:–—-]+/, "") || fallback;
}

export function reasoningLabel(effort: AgentReasoningEffort): string {
  if (effort === "xhigh") return "Extra high";
  return `${effort.slice(0, 1).toUpperCase()}${effort.slice(1)}`;
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
