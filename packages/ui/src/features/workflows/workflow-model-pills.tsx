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
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
import { useText } from "../../text";
import {
  createPickerFades,
  type PickerChip,
  PickerMenu,
  type PickerOption,
  PickerRow,
  pickerMatches,
} from "./WorkflowPicker";
import { Hint, useBoard } from "./workflow-board";
import { type WorkflowCatalogs, workflowModelProviders } from "./workflow-model";
import { type WfProvider, wfProviderLogo } from "./workflow-node-parts";

export const EFFORT_LABEL = {
  none: "provider.effort.none",
  minimal: "provider.effort.minimal",
  low: "provider.effort.low",
  medium: "provider.effort.medium",
  high: "provider.effort.high",
  xhigh: "provider.effort.xhigh",
  max: "provider.effort.max",
  ultra: "provider.effort.ultra",
} as const satisfies Record<AgentReasoningEffort, AppTextKey>;

export function modelOption(models: readonly ClientAgentModelOption[], id: AgentModelId) {
  return models.find((option) => option.id === id);
}

const providerName = (catalogs: WorkflowCatalogs, provider: AgentProviderRef) =>
  providerDisplayName(provider, catalogs.status.providers?.find((status) => status.id === provider)?.displayName);

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

export function ModelPill(props: {
  provider: WfProvider;
  value: AgentModelId;
  placeholder?: string;
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
  const placeholder = () => (props.value === "" ? props.placeholder : undefined);
  const label = () => placeholder() ?? current()?.name ?? props.value;
  let panel: HTMLDivElement | undefined;
  const fades = createPickerFades();
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
        aria-label={t("workflow.model.label", { name: label() })}
        disabled={props.disabled}
      >
        <Show when={!placeholder()}>
          <ProviderLogo provider={wfProviderLogo(props.provider)} class="wfn-model-logo" />
        </Show>
        <span>{label()}</span>
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
                        fades.bind(element);
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
                      class={["wfn-picker-list wfn-model-list", fades.classes()]}
                      onScroll={fades.measure}
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
                    <ScrollEdgeBlur fades={fades} />
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

const EFFORT_LEVEL: Record<AgentReasoningEffort, number> = {
  none: 0,
  minimal: 1,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
  ultra: 5,
};

function EffortMeter(props: { effort: AgentReasoningEffort }) {
  return (
    <span class="wfn-picker-meter" aria-hidden="true">
      <For each={[1, 2, 3, 4, 5]}>{(bar) => <i data-on={bar <= EFFORT_LEVEL[props.effort] ? "" : undefined} />}</For>
    </span>
  );
}

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
