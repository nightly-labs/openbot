import { ProviderLogo } from "@openbot/brand";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type WorkflowMediaKind,
  workflowMediaResolutions,
  workflowVideoDurations,
} from "@openbot/contracts/ipc";
import {
  buttonVariants,
  ChevronDown,
  Clock3,
  Input,
  LabelTooltipTrigger,
  LayoutGrid,
  Listbox,
  Mic,
  Popover,
  Search,
  Tabs,
} from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { isApiKeyAccount, providerAccountName } from "../../components/provider-accounts";
import { useText } from "../../text";
import { creditModelMakerNamed, MakerLogo } from "../credits/MakerLogo";
import { createPickerFades, type PickerChip, type PickerOption, PickerRow, pickerMatches } from "./WorkflowPicker";
import { Hint } from "./workflow-board";
import { resolutionsBySize } from "./workflow-media-step";
import type { WorkflowImageModel } from "./workflow-model";

interface PayerEntry {
  key: string;
  payer: WorkflowImageModel;
  accountId: string | null;
  label: string;
  account?: { number: number; name: string };
}

const ALL = "all";
const entryKey = (provider: string, accountId: string | null) => (accountId ? `${provider}:${accountId}` : provider);
const rowValue = (entry: string, model: string) => `${entry}|${model}`;

function ModelLogo(props: { model: WorkflowImageModel }) {
  return (
    <Show
      when={props.model.provider === "openbot" && creditModelMakerNamed(props.model.maker)}
      fallback={<ProviderLogo provider={props.model.provider} class="wfn-model-logo" />}
    >
      {(maker) => <MakerLogo maker={maker()} mono />}
    </Show>
  );
}

function span(values: readonly string[]): string | undefined {
  const sorted = resolutionsBySize(values);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return undefined;
  return first === last ? first : `${first}–${last}`;
}

function mediaStepAccount(model: WorkflowImageModel | undefined, account: string): string | null {
  if (!model || account === "" || account === DEFAULT_PROVIDER_ACCOUNT_ID) return null;
  return model.accounts?.some((row) => row.id === account) ? account : null;
}

export function MediaModelPicker(props: {
  kind: WorkflowMediaKind;
  models: readonly WorkflowImageModel[];
  model: WorkflowImageModel | undefined;
  savedName?: string | undefined;
  account: string;
  title: string;
  disabled?: boolean;
  onChange: (model: WorkflowImageModel, accountId: string | null) => void;
}) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [tab, setTab] = createSignal<string>(ALL);
  let panel: HTMLDivElement | undefined;
  let opening = false;

  const payerText = (model: WorkflowImageModel, accountId: string | null) => {
    if (accountId ? isApiKeyAccount(accountId) : model.apiKey) return t("workflow.media.apiKey", { name: model.maker });
    if (model.credits) return t("workflow.media.credits", { name: model.subscription });
    return t("workflow.media.subscription", { name: model.subscription });
  };
  const entries = (): PayerEntry[] => {
    const payers = new Map<string, WorkflowImageModel>();
    for (const model of props.models) if (!payers.has(model.provider)) payers.set(model.provider, model);
    return [...payers.values()].flatMap((payer): PayerEntry[] => {
      const accounts = payer.accounts ?? [];
      if (accounts.length < 2) return [{ key: payer.provider, payer, accountId: null, label: payerText(payer, null) }];
      return accounts.map((row, index) => {
        const accountId = row.id === DEFAULT_PROVIDER_ACCOUNT_ID ? null : row.id;
        const name = providerAccountName(t, accounts, row.id);
        return {
          key: entryKey(payer.provider, accountId),
          payer,
          accountId,
          label: `${payerText(payer, accountId)} · ${name}`,
          account: { number: index + 1, name },
        };
      });
    });
  };
  const current = () => {
    const model = props.model;
    return model ? entryKey(model.provider, mediaStepAccount(model, props.account)) : ALL;
  };
  const currentEntry = () => entries().find((entry) => entry.key === current());
  const tabLabel = () => entries().find((entry) => entry.key === tab())?.label ?? props.title;
  const name = () => props.model?.name ?? props.savedName ?? t("workflow.image.chooseModel");
  const accountName = () => currentEntry()?.account?.name;
  const label = () => (accountName() ? `${name()} · ${accountName()}` : name());

  const specChips = (model: WorkflowImageModel): PickerChip[] => {
    const chips: PickerChip[] = [];
    const resolutions = span(workflowMediaResolutions(model, props.kind));
    if (resolutions) chips.push({ text: resolutions });
    if (props.kind === "video") {
      const lengths = workflowVideoDurations(model);
      const low = Math.min(...lengths);
      const high = Math.max(...lengths);
      chips.push({
        icon: () => <Clock3 aria-hidden="true" />,
        text: t("workflow.video.seconds", { value: low === high ? String(low) : `${low}–${high}` }),
      });
      if (model.voices) chips.push({ icon: () => <Mic aria-hidden="true" />, text: t("workflow.video.voice") });
    }
    return chips;
  };
  const rows = (key: string): PickerOption<string>[] => {
    const text = query().trim().toLowerCase();
    const options = entries()
      .filter((entry) => key === ALL || entry.key === key)
      .flatMap((entry) =>
        props.models
          .filter((model) => model.provider === entry.payer.provider)
          .map((model) => ({
            value: rowValue(entry.key, model.id),
            label: model.name,
            tile: () => <ModelLogo model={model} />,
            chips: [
              ...specChips(model),
              ...(key === ALL
                ? [{ text: entry.account ? `${model.subscription} · ${entry.account.name}` : model.subscription }]
                : []),
            ],
            searchText: `${model.maker} ${entry.label}`,
          })),
      );
    return text ? options.filter((option) => pickerMatches(option, text)) : options;
  };
  const choose = (value: string) => {
    const [key = "", id = ""] = value.split("|");
    const entry = entries().find((candidate) => candidate.key === key);
    const model = props.models.find((candidate) => candidate.id === id);
    const stored = props.account === DEFAULT_PROVIDER_ACCOUNT_ID ? "" : props.account;
    if (entry && model && (value !== selected() || stored !== (entry.accountId ?? "")))
      props.onChange(model, entry.accountId);
    setOpen(false);
  };
  const selected = () => (props.model ? rowValue(current(), props.model.id) : undefined);

  return (
    <Popover.Root
      open={open()}
      onOpenChange={(next) => {
        if (next) {
          setQuery("");
          setTab(currentEntry() ? current() : ALL);
          opening = true;
        }
        setOpen(next);
      }}
      placement="bottom-start"
      gutter={6}
      modal
    >
      <Popover.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill wfn-media-pill`}
        aria-label={t("workflow.model.label", { name: label() })}
        disabled={props.disabled}
      >
        <Show when={props.model}>{(model) => <ProviderLogo provider={model().provider} class="wfn-model-logo" />}</Show>
        <Show when={currentEntry()?.account}>
          {(account) => (
            <span class="wfn-media-account-badge" aria-hidden="true">
              {account().number}
            </span>
          )}
        </Show>
        <span class="wfn-media-pill-name">{name()}</span>
        <Show when={accountName()}>{(account) => <span class="wfn-media-pill-account">{account()}</span>}</Show>
        <ChevronDown aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element: HTMLDivElement) => {
            panel = element;
          }}
          class="ui-action-menu wfn-menu wfn-picker wfn-model-picker wfn-media-picker"
          data-wfn-portal=""
          onFocusIn={() => {
            if (!opening) return;
            opening = false;
            panel?.querySelector("[role=tabpanel] [role=option][data-selected]")?.scrollIntoView({ block: "nearest" });
            panel?.querySelector<HTMLInputElement>(".wfn-picker-field")?.focus();
          }}
        >
          <Popover.Title class="sr-only">{t("workflow.model.title")}</Popover.Title>
          <Tabs.Root
            value={tab()}
            onChange={setTab}
            orientation="vertical"
            activationMode="automatic"
            class="wfn-model-layout"
          >
            <Tabs.List class="wfn-model-rail wfn-media-rail" aria-label={t("workflow.media.payers")}>
              <Hint label={props.title} placement="left">
                <LabelTooltipTrigger as="div" class="wfn-model-tab-hint">
                  <Tabs.Trigger value={ALL} class="wfn-model-tab" aria-label={props.title}>
                    <LayoutGrid class="wfn-model-mark wfn-media-all-mark" aria-hidden="true" />
                  </Tabs.Trigger>
                </LabelTooltipTrigger>
              </Hint>
              <For each={entries()}>
                {(entry) => (
                  <Hint label={entry.label} placement="left">
                    <LabelTooltipTrigger as="div" class="wfn-model-tab-hint">
                      <Tabs.Trigger value={entry.key} class="wfn-model-tab" aria-label={entry.label}>
                        <ProviderLogo provider={entry.payer.provider} class="wfn-model-mark" />
                        <Show when={entry.account}>
                          {(account) => (
                            <span class="wfn-media-account-badge" aria-hidden="true">
                              {account().number}
                            </span>
                          )}
                        </Show>
                      </Tabs.Trigger>
                    </LabelTooltipTrigger>
                  </Hint>
                )}
              </For>
            </Tabs.List>
            <div class="wfn-model-panel">
              <strong class="wfn-model-heading">{tabLabel()}</strong>
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
                    if (event.key === "Enter") {
                      const [first] = rows(tab());
                      if (first) choose(first.value);
                      return;
                    }
                    panel?.querySelector<HTMLElement>("[role=tabpanel] [role=option]")?.focus();
                  }}
                />
              </div>
              <For each={[ALL, ...entries().map((entry) => entry.key)]}>
                {(key) => (
                  <Tabs.Content value={key} class="wfn-media-list">
                    <RowList
                      label={key === ALL ? props.title : tabLabel()}
                      rows={rows(key)}
                      value={selected()}
                      onChoose={choose}
                    />
                  </Tabs.Content>
                )}
              </For>
            </div>
          </Tabs.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RowList(props: {
  label: string;
  rows: readonly PickerOption<string>[];
  value: string | undefined;
  onChoose: (value: string) => void;
}) {
  const { t } = useText();
  const fades = createPickerFades();
  return (
    <Show when={props.rows.length} fallback={<p class="wfn-picker-empty">{t("workflow.picker.noMatches")}</p>}>
      <Listbox.Root<PickerOption<string>>
        ref={fades.bind}
        class={["wfn-picker-list wfn-model-list", fades.classes()]}
        onScroll={fades.measure}
        aria-label={props.label}
        options={[...props.rows]}
        optionValue={(option) => option.value}
        optionTextValue={(option) => option.label}
        value={props.value === undefined ? [] : [props.value]}
        selectionMode="single"
        shouldFocusWrap
        renderItem={(item) => (
          <Listbox.Item
            item={item}
            class="wfn-picker-row"
            onClick={() => props.onChoose(item.rawValue.value)}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") props.onChoose(item.rawValue.value);
            }}
          >
            <PickerRow option={item.rawValue} checked={item.rawValue.value === props.value} />
          </Listbox.Item>
        )}
      />
    </Show>
  );
}
