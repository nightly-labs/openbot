/**
 * The model and effort pills of the LLM and agent steps. The models come from the catalogs of the
 * board. The list offers only the providers that the host can run now or soon, and the provider of
 * the step.
 */

import { ProviderLogo } from "@openbot/brand";
import {
  type AgentModelId,
  type AgentProviderRef,
  type AgentReasoningEffort,
  type ClientAgentModelOption,
  providerDisplayName,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  buttonVariants,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  DropdownMenu,
  Input,
  LabelTooltipTrigger,
  Listbox,
  Popover,
  Search,
  Tabs,
  Zap,
} from "@openbot/ui";
import { createSignal, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { type PickerChip, PickerMenu, type PickerOption, PickerRow, pickerMatches } from "./WorkflowPicker";
import { Hint, useBoard } from "./workflow-board";
import { type WorkflowCatalogs, workflowModelProviders } from "./workflow-model";
import { type WfProvider, wfProviderLogo } from "./workflow-node-parts";

const EFFORT_LABEL = {
  low: "provider.effort.low",
  medium: "provider.effort.medium",
  high: "provider.effort.high",
  xhigh: "provider.effort.xhigh",
  max: "provider.effort.max",
} as const satisfies Record<AgentReasoningEffort, AppTextKey>;

/** The model with this id in a list of models. */
export function modelOption(models: readonly ClientAgentModelOption[], id: AgentModelId) {
  return models.find((option) => option.id === id);
}

/** The name of a provider. A provider that this build does not know has the name that its host sends. */
const providerName = (catalogs: WorkflowCatalogs, provider: AgentProviderRef) =>
  providerDisplayName(provider, catalogs.status.providers?.find((status) => status.id === provider)?.displayName);

/** The facts of a model that the picker shows: the efforts that it supports, and the fast tier. */
function modelChips(t: AppTranslate, option: ClientAgentModelOption): PickerChip[] {
  const efforts = option.supportedReasoningEfforts;
  const first = efforts[0];
  const last = efforts.at(-1);
  const chips: PickerChip[] = [];
  if (first && last) {
    chips.push({
      icon: () => <ChartNoAxesColumnIncreasing aria-hidden="true" />,
      text:
        first === last
          ? t(EFFORT_LABEL[first])
          : t("workflow.model.effortRange", { from: t(EFFORT_LABEL[first]), to: t(EFFORT_LABEL[last]) }),
    });
  }
  if (option.fastServiceTier) chips.push({ icon: () => <Zap aria-hidden="true" />, text: t("provider.picker.fast") });
  return chips;
}

/**
 * The model of a step, in the layout of the model picker in the conversation header: a rail of
 * provider logos, and beside it the name, the search field and the models of the chosen provider.
 * The rows have the style of every other list on the canvas.
 */
export function ModelPill(props: {
  provider: WfProvider;
  value: AgentModelId;
  disabled?: boolean;
  onChange: (model: AgentModelId, provider: WfProvider) => void;
}) {
  const board = useBoard();
  const { t } = useText();
  const models = () => board.catalogs().models;
  const providers = () => workflowModelProviders(board.catalogs(), props.provider);
  const name = (provider: AgentProviderRef) => providerName(board.catalogs(), provider);
  const [open, setOpen] = createSignal(false);
  const [tab, setTab] = createSignal<AgentProviderRef>(untrack(() => props.provider));
  const [query, setQuery] = createSignal("");
  const current = () => modelOption(models(), props.value);
  let panel: HTMLDivElement | undefined;
  let opening = false;
  const rows = (provider: AgentProviderRef) => {
    const text = query().trim().toLowerCase();
    const options: PickerOption<AgentModelId>[] = models()
      .filter((option) => option.provider === provider)
      .map((option) => ({ value: option.id, label: option.name, chips: modelChips(t, option) }));
    return text ? options.filter((option) => pickerMatches(option, text)) : options;
  };
  const choose = (id: AgentModelId) => {
    const option = modelOption(models(), id);
    if (option && id !== props.value) props.onChange(id, option.provider);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open()}
      onOpenChange={(next) => {
        if (next) {
          // Each open starts on the provider of the step, with no filter.
          setTab(props.provider);
          setQuery("");
          opening = true;
        }
        setOpen(next);
      }}
      placement="bottom-start"
      gutter={6}
      modal
    >
      <Popover.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill wfn-model-pill`}
        aria-label={t("workflow.model.label", { name: current()?.name ?? props.value })}
        disabled={props.disabled}
      >
        <ProviderLogo provider={wfProviderLogo(props.provider)} class="wfn-model-logo" />
        <span>{current()?.name ?? props.value}</span>
        <ChevronDown aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element: HTMLDivElement) => {
            panel = element;
          }}
          class="ui-action-menu wfn-menu wfn-picker wfn-model-picker"
          data-wfn-portal=""
          onFocusIn={() => {
            // The popover focuses its first control once it opens. Then the chosen row scrolls
            // into view, and the search field takes the focus, as in every other list with a search.
            if (!opening) return;
            opening = false;
            panel?.querySelector("[role=option][data-selected]")?.scrollIntoView({ block: "nearest" });
            panel?.querySelector<HTMLInputElement>(".wfn-picker-field")?.focus();
          }}
        >
          <Popover.Title class="sr-only">{t("workflow.model.title")}</Popover.Title>
          <Tabs.Root
            value={tab()}
            onChange={(value: string) => {
              const provider = providers().find((candidate) => candidate === value);
              if (provider) setTab(provider);
            }}
            orientation="vertical"
            activationMode="automatic"
            class="wfn-model-layout"
          >
            <Tabs.List class="wfn-model-rail" aria-label={t("workflow.model.providers")}>
              <For each={providers()}>
                {(provider) => (
                  <Hint label={name(provider)} placement="left">
                    <LabelTooltipTrigger as="div" class="wfn-model-tab-hint">
                      <Tabs.Trigger value={provider} class="wfn-model-tab" aria-label={name(provider)}>
                        <ProviderLogo provider={wfProviderLogo(provider)} class="wfn-model-mark" />
                      </Tabs.Trigger>
                    </LabelTooltipTrigger>
                  </Hint>
                )}
              </For>
            </Tabs.List>
            <For each={providers()}>
              {(provider) => (
                <Tabs.Content value={provider} class="wfn-model-panel">
                  <strong class="wfn-model-heading">{name(provider)}</strong>
                  <div class="wfn-picker-search">
                    <Search aria-hidden="true" />
                    <Input
                      class="wfn-picker-field"
                      aria-label={t("provider.picker.search")}
                      placeholder={t("provider.picker.search")}
                      value={query()}
                      onValueChange={setQuery}
                      onKeyDown={(event: KeyboardEvent) => {
                        if (event.key !== "ArrowDown" && event.key !== "Enter") return;
                        event.preventDefault();
                        const [first] = rows(provider);
                        // Enter takes the first match; the down arrow moves to the rows.
                        if (event.key === "Enter") {
                          if (first) choose(first.value);
                          return;
                        }
                        panel?.querySelector<HTMLElement>("[role=option]:not([data-disabled])")?.focus();
                      }}
                    />
                  </div>
                  <Show
                    when={rows(provider).length}
                    fallback={<p class="wfn-picker-empty">{t("workflow.picker.noMatches")}</p>}
                  >
                    <Listbox.Root<PickerOption<AgentModelId>>
                      ref={(element: HTMLUListElement) => {
                        // A letter typed on a row goes back to the field, so typing always searches.
                        element.addEventListener(
                          "keydown",
                          (event) => {
                            if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
                            event.stopPropagation();
                            panel?.querySelector<HTMLInputElement>(".wfn-picker-field")?.focus();
                          },
                          true,
                        );
                      }}
                      class="wfn-picker-list wfn-model-list"
                      aria-label={t("workflow.model.providerModels", { name: name(provider) })}
                      options={[...rows(provider)]}
                      optionValue={(option) => option.value}
                      optionTextValue={(option) => option.label}
                      value={[props.value]}
                      selectionMode="single"
                      disallowEmptySelection
                      shouldFocusWrap
                      renderItem={(item) => (
                        <Listbox.Item
                          item={item}
                          class="wfn-picker-row"
                          onClick={() => choose(item.rawValue.value)}
                          onKeyDown={(event: KeyboardEvent) => {
                            if (event.key === "Enter" || event.key === " ") choose(item.rawValue.value);
                          }}
                        >
                          <PickerRow option={item.rawValue} checked={item.rawValue.value === props.value} />
                        </Listbox.Item>
                      )}
                    />
                  </Show>
                </Tabs.Content>
              )}
            </For>
          </Tabs.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const EFFORT_LEVEL: Record<AgentReasoningEffort, number> = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };

/** Five bars, lit up to the level of an effort. */
function EffortMeter(props: { effort: AgentReasoningEffort }) {
  return (
    <span class="wfn-picker-meter" aria-hidden="true">
      <For each={[1, 2, 3, 4, 5]}>{(bar) => <i data-on={bar <= EFFORT_LEVEL[props.effort] ? "" : undefined} />}</For>
    </span>
  );
}

/** How long the model thinks. The menu lists only the efforts that the chosen model supports. */
export function EffortPill(props: {
  efforts: readonly AgentReasoningEffort[];
  value: AgentReasoningEffort;
  disabled?: boolean;
  onChange: (effort: AgentReasoningEffort) => void;
}) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill`}
        aria-label={t("workflow.model.effort", { name: t(EFFORT_LABEL[props.value]) })}
        disabled={props.disabled || props.efforts.length < 2}
      >
        <ChartNoAxesColumnIncreasing aria-hidden="true" />
        <span>{t(EFFORT_LABEL[props.value])}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={t("provider.picker.effort")}
          groups={[
            {
              options: props.efforts.map((choice) => ({
                value: choice,
                label: t(EFFORT_LABEL[choice]),
                tile: () => <EffortMeter effort={choice} />,
              })),
            },
          ]}
          value={props.value}
          onSelect={props.onChange}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
