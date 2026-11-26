import {
  type CreditMediaGenerationKind,
  type CreditMediaModel,
  creditMediaCost,
  creditMediaSpendable,
} from "@openbot/contracts/credit-media";
import type {
  AgentApproval,
  MediaApprovalBalance,
  MediaApprovalChoice,
  MediaApprovalOffer,
  MediaApprovalRead,
} from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import {
  Button,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Gift,
  Input,
  Listbox,
  Lock,
  Monitor,
  Popover,
  Scan,
  Search,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Star,
  toast,
  Volume2,
  VolumeX,
} from "@openbot/ui";
import { CreditAmount } from "@openbot/ui/features/credits/CreditIcon";
import { creditModelMakerNamed, MakerLogo } from "@openbot/ui/features/credits/MakerLogo";
import { createPickerFades } from "@openbot/ui/features/workflows/WorkflowPicker";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createStore, Show, untrack } from "solid-js";
import type { CreditsHoldControls } from "./CreditsHoldCard";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

export interface MediaApprovalControls {
  read: (approval: AgentApproval) => Promise<MediaApprovalRead>;
  allow: (approval: AgentApproval, choice: MediaApprovalChoice) => Promise<boolean>;
  setDefault?: ((kind: CreditMediaGenerationKind, model: string | null) => Promise<void>) | undefined;
  hold?: CreditsHoldControls | undefined;
}

export function mediaApprovalCandidate(approval: AgentApproval): boolean {
  return (
    approval.kind === "permissions" &&
    approval.command === null &&
    approval.cwd === null &&
    approval.grantRoot === null &&
    approval.permissions === null
  );
}

type MediaSettings = Omit<MediaApprovalChoice, "model">;

function supported<T>(values: readonly T[], wanted: T | null, fallback: T | null): T | null {
  return wanted !== null && values.includes(wanted) ? wanted : (fallback ?? values[0] ?? null);
}

function nearestDuration(model: CreditMediaModel, wanted: number | null): number | null {
  if (model.kind !== "video") return null;
  if (wanted === null) return model.defaultDuration ?? model.durations[0] ?? null;
  return model.durations.reduce<number | null>(
    (best, value) => (best === null || Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best),
    null,
  );
}

function settingsFor(model: CreditMediaModel, wanted: MediaSettings): MediaSettings {
  return {
    aspect: supported(model.aspects, wanted.aspect, model.defaultAspect),
    resolution: supported(model.resolutions, wanted.resolution, model.defaultResolution),
    duration: nearestDuration(model, wanted.duration),
    audio: model.audio && wanted.audio,
  };
}

function costFor(model: CreditMediaModel, settings: MediaSettings): number | null {
  return creditMediaCost(model, { ...settings, count: 1 });
}

function makerOf(model: CreditMediaModel) {
  return creditModelMakerNamed(model.maker);
}

function ModelLogo(props: { model: CreditMediaModel; class?: string | undefined }) {
  return <Show when={makerOf(props.model)}>{(maker) => <MakerLogo maker={maker()} mono class={props.class} />}</Show>;
}

function AgentPickNote(props: { agentName: string | undefined }) {
  const { t } = useText();
  const text = () =>
    props.agentName
      ? t("prompt.mediaApproval.agentPick", { agent: props.agentName })
      : t("prompt.mediaApproval.agentPickUnnamed");
  return <span class="media-approval-agent-pick">{text()}</span>;
}

function onFreeCredits(balance: MediaApprovalBalance | undefined): balance is MediaApprovalBalance {
  return balance !== undefined && balance.welcome > 0;
}

function FreeCreditsChip() {
  const { t } = useText();
  return (
    <span class="wfn-picker-chip media-approval-free-chip">
      <Gift aria-hidden="true" />
      {t("prompt.mediaApproval.freeCredits")}
    </span>
  );
}

function ModelPicker(props: {
  models: readonly CreditMediaModel[];
  value: string;
  agentModel: string;
  agentName: string | undefined;
  defaultModel: string | null;
  label: string;
  settings: MediaSettings;
  balance: MediaApprovalBalance | undefined;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const { t, format } = useText();
  const fades = createPickerFades();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  let panel: HTMLDivElement | undefined;
  let opening = false;
  const current = () => props.models.find((model) => model.id === props.value);
  const priceOf = (model: CreditMediaModel) => {
    const settings = settingsFor(model, props.settings);
    const credits = costFor(model, settings);
    return {
      credits,
      unit:
        settings.duration === null
          ? t("prompt.mediaApproval.perImage")
          : t("prompt.mediaApproval.forSeconds", { count: format.number(settings.duration) }),
    };
  };
  const shown = createMemo(() => {
    const text = query().trim().toLowerCase();
    if (!text) return [...props.models];
    return props.models.filter((model) =>
      [model.name, model.variant ?? "", model.maker].some((part) => part.toLowerCase().includes(text)),
    );
  });
  const freeShown = () => onFreeCredits(props.balance);
  const paidOnly = (model: CreditMediaModel) => {
    const balance = props.balance;
    if (!onFreeCredits(balance) || model.welcome === true) return false;
    const credits = priceOf(model).credits;
    return credits === null || credits > creditMediaSpendable(balance, false);
  };
  const choose = (model: CreditMediaModel) => {
    if (paidOnly(model)) return;
    if (model.id !== props.value) props.onChange(model.id);
    setOpen(false);
  };
  const agentPickMark = (id: string) => (props.agentModel === id ? "" : undefined);
  return (
    <Popover.Root
      open={open()}
      onOpenChange={(next) => {
        if (next) {
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
        class="ui-select-trigger media-approval-select"
        data-size="sm"
        aria-label={props.label}
        disabled={props.disabled}
      >
        <Show when={current()}>
          {(model) => (
            <span class="ui-select-value media-approval-select-value">
              <ModelLogo model={model()} class="media-approval-logo" />
              {model().name}
              <Show when={model().variant}>
                {(variant) => <span class="media-approval-trigger-variant">{variant()}</span>}
              </Show>
              <Show when={props.agentModel === model().id}>
                <AgentPickNote agentName={props.agentName} />
              </Show>
            </span>
          )}
        </Show>
        <span class="ui-select-trigger-icon">
          <ChevronsUpDown aria-hidden="true" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element: HTMLDivElement) => {
            panel = element;
          }}
          class="ui-action-menu wfn-menu wfn-picker media-approval-picker"
          onFocusIn={() => {
            if (!opening) return;
            opening = false;
            panel?.querySelector("[role=option][data-selected]")?.scrollIntoView({ block: "nearest" });
            panel?.querySelector<HTMLInputElement>(".wfn-picker-field")?.focus();
          }}
        >
          <Popover.Title class="sr-only">{props.label}</Popover.Title>
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
                  const first = shown().find((model) => !paidOnly(model));
                  if (first) choose(first);
                  return;
                }
                panel?.querySelector<HTMLElement>("[role=option]")?.focus();
              }}
            />
          </div>
          <Show when={shown().length} fallback={<p class="wfn-picker-empty">{t("provider.picker.noMatches")}</p>}>
            <Listbox.Root<CreditMediaModel>
              ref={fades.bind}
              class={["wfn-picker-list wfn-model-list", fades.classes()]}
              onScroll={fades.measure}
              aria-label={props.label}
              options={shown()}
              optionValue={(option) => option.id}
              optionTextValue={(option) => option.name}
              optionDisabled={paidOnly}
              value={[props.value]}
              selectionMode="single"
              shouldFocusWrap
              renderItem={(item) => (
                <Listbox.Item
                  item={item}
                  class="wfn-picker-row media-approval-row"
                  data-agent-pick={agentPickMark(item.rawValue.id)}
                  onClick={() => choose(item.rawValue)}
                  onKeyDown={(event: KeyboardEvent) => {
                    if (event.key === "Enter" || event.key === " ") choose(item.rawValue);
                  }}
                >
                  <span class="wfn-picker-tile">
                    <ModelLogo model={item.rawValue} />
                  </span>
                  <span class="wfn-picker-body">
                    <span class="wfn-picker-name media-approval-row-name">
                      {item.rawValue.name}
                      <Show when={props.agentModel === item.rawValue.id}>
                        <AgentPickNote agentName={props.agentName} />
                      </Show>
                    </span>
                    <span class="wfn-picker-chips">
                      <span class="wfn-picker-chip">{item.rawValue.maker}</span>
                      <Show when={item.rawValue.variant}>
                        {(variant) => <span class="wfn-picker-chip">{variant()}</span>}
                      </Show>
                      <Show when={props.defaultModel === item.rawValue.id}>
                        <span class="wfn-picker-chip">
                          <Star aria-hidden="true" />
                          {t("prompt.mediaApproval.default")}
                        </span>
                      </Show>
                      <Show when={freeShown() && item.rawValue.welcome === true}>
                        <FreeCreditsChip />
                      </Show>
                    </span>
                  </span>
                  <Show
                    when={paidOnly(item.rawValue)}
                    fallback={
                      <span class="media-approval-row-price">
                        <CreditAmount credits={priceOf(item.rawValue).credits} />
                        <span class="media-approval-row-unit">{priceOf(item.rawValue).unit}</span>
                      </span>
                    }
                  >
                    <span class="media-approval-row-price media-approval-row-locked">
                      <span class="media-approval-paid-only">
                        <Lock aria-hidden="true" />
                        {t("prompt.mediaApproval.paidOnly")}
                      </span>
                      <span class="media-approval-row-unit">
                        <CreditAmount credits={priceOf(item.rawValue).credits} />
                        {priceOf(item.rawValue).unit}
                      </span>
                    </span>
                  </Show>
                </Listbox.Item>
              )}
            />
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DurationSelect(props: {
  durations: readonly number[];
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const { t, format } = useText();
  const seconds = (value: number) => t("prompt.mediaApproval.seconds", { count: format.number(value) });
  const options = createMemo(() => [...props.durations]);
  return (
    <Select<number>
      class="media-approval-duration"
      options={options()}
      value={props.value}
      disabled={props.disabled}
      onChange={(value) => {
        if (value !== null && value !== props.value) props.onChange(value);
      }}
      placement="bottom-end"
      itemComponent={(item) => <SelectItem item={item.item}>{seconds(item.item.rawValue)}</SelectItem>}
    >
      <SelectTrigger size="sm" aria-label={t("prompt.mediaApproval.duration")}>
        <SelectValue<number>>{(state) => seconds(state.selectedOption())}</SelectValue>
      </SelectTrigger>
      <SelectContent />
    </Select>
  );
}

type SoundOption = "sound" | "silent";
const SOUND_OPTIONS: SoundOption[] = ["sound", "silent"];

function SettingSelect<T extends string>(props: {
  label: string;
  options: readonly T[];
  value: T;
  disabled: boolean;
  format: (value: T) => string;
  icon: (value: T) => JSX.Element;
  onChange: (value: T) => void;
}) {
  const content = (value: T) => (
    <>
      {props.icon(value)}
      <span>{props.format(value)}</span>
    </>
  );
  const options = createMemo(() => [...props.options]);
  return (
    <Show
      when={props.options.length > 1}
      fallback={<span class="media-approval-setting-fixed">{content(props.value)}</span>}
    >
      <Select<T>
        class="media-approval-setting"
        options={options()}
        value={props.value}
        disabled={props.disabled}
        onChange={(value) => {
          if (value !== null && value !== props.value) props.onChange(value);
        }}
        placement="bottom-start"
        itemComponent={(item) => <SelectItem item={item.item}>{props.format(item.item.rawValue)}</SelectItem>}
      >
        <SelectTrigger size="sm" aria-label={props.label}>
          <SelectValue<T>>
            {(state) => (
              <>
                {content(state.selectedOption())}
                <ChevronDown class="media-approval-chip-chevron" aria-hidden="true" />
              </>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
    </Show>
  );
}

const asText = (value: string) => value;
const aspectIcon = () => <Scan aria-hidden="true" />;
const resolutionIcon = () => <Monitor aria-hidden="true" />;
const soundIcon = (value: SoundOption) =>
  value === "sound" ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />;

function SettingChips(props: {
  model: CreditMediaModel;
  settings: MediaSettings;
  disabled: boolean;
  onChange: (patch: Partial<MediaSettings>) => void;
}) {
  const { t } = useText();
  const sound = (): SoundOption => (props.settings.audio ? "sound" : "silent");
  const soundText = (value: SoundOption) =>
    value === "sound" ? t("prompt.mediaApproval.sound") : t("prompt.mediaApproval.noSound");
  return (
    <div class="media-approval-chips">
      <Show when={props.settings.aspect}>
        {(aspect) => (
          <SettingSelect
            label={t("prompt.mediaApproval.aspect")}
            options={props.model.aspects}
            value={aspect()}
            disabled={props.disabled}
            format={asText}
            icon={aspectIcon}
            onChange={(value) => props.onChange({ aspect: value })}
          />
        )}
      </Show>
      <Show when={props.settings.resolution}>
        {(resolution) => (
          <SettingSelect
            label={t("prompt.mediaApproval.resolution")}
            options={props.model.resolutions}
            value={resolution()}
            disabled={props.disabled}
            format={asText}
            icon={resolutionIcon}
            onChange={(value) => props.onChange({ resolution: value })}
          />
        )}
      </Show>
      <Show when={props.model.audio}>
        <SettingSelect<SoundOption>
          label={t("prompt.mediaApproval.sound")}
          options={SOUND_OPTIONS}
          value={sound()}
          disabled={props.disabled}
          format={soundText}
          icon={soundIcon}
          onChange={(value) => props.onChange({ audio: value === "sound" })}
        />
      </Show>
    </div>
  );
}

function DefaultButton(props: { isDefault: boolean; disabled: boolean; onClick: () => void }) {
  const { t } = useText();
  const pressed = () => (props.isDefault ? "true" : "false");
  const text = () => (props.isDefault ? t("prompt.mediaApproval.default") : t("prompt.mediaApproval.setDefault"));
  return (
    <Button
      variant="secondary"
      size="sm"
      type="button"
      aria-pressed={pressed()}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Show when={props.isDefault}>
        <Check aria-hidden="true" />
      </Show>
      {text()}
    </Button>
  );
}

interface CardState {
  model: string;
  settings: MediaSettings;
  defaultModel: string | null;
  savingDefault: boolean;
}

export function MediaApprovalCard(props: {
  offer: MediaApprovalOffer;
  agentName?: string | undefined;
  submitting: boolean;
  onDeny: () => void;
  onAllow: (choice: MediaApprovalChoice) => void;
  onSetDefault?: ((model: string | null) => Promise<void>) | undefined;
}) {
  const { t } = useText();
  const initial = untrack(
    (): CardState => ({
      model: props.offer.choice.model,
      settings: {
        aspect: props.offer.choice.aspect,
        resolution: props.offer.choice.resolution,
        duration: props.offer.choice.duration,
        audio: props.offer.choice.audio,
      },
      defaultModel: props.offer.defaultModel,
      savingDefault: false,
    }),
  );
  const [state, setState] = createStore(initial);
  const picked = () => props.offer.models.find((model) => model.id === state.model);
  const cost = () => {
    const model = picked();
    return model ? costFor(model, state.settings) : null;
  };
  const isDefault = () => state.defaultModel === state.model;
  const title = () =>
    props.offer.kind === "image" ? t("prompt.mediaApproval.imageTitle") : t("prompt.mediaApproval.videoTitle");
  const modelLabel = () =>
    props.offer.kind === "image" ? t("prompt.mediaApproval.imageModel") : t("prompt.mediaApproval.videoModel");
  const duration = () => (picked()?.kind === "video" ? state.settings.duration : null);
  const canSetDefault = () => props.offer.canSetDefault && props.onSetDefault !== undefined;
  const chooseModel = (id: string) => {
    const model = props.offer.models.find((entry) => entry.id === id);
    if (!model) return;
    setState((draft) => {
      draft.model = model.id;
      draft.settings = settingsFor(model, draft.settings);
    });
  };
  const changeSettings = (patch: Partial<MediaSettings>) =>
    setState((draft) => {
      draft.settings = { ...draft.settings, ...patch };
    });
  const toggleDefault = async () => {
    const save = props.onSetDefault;
    if (!save || state.savingDefault) return;
    const next = isDefault() ? null : state.model;
    setState((draft) => {
      draft.savingDefault = true;
    });
    try {
      await save(next);
      setState((draft) => {
        draft.defaultModel = next;
      });
    } catch (error) {
      toast.error(t("prompt.mediaApproval.defaultFailed"), {
        report: { operation: "turn", source: "system", cause_code: classifyFailure(error) },
      });
    } finally {
      setState((draft) => {
        draft.savingDefault = false;
      });
    }
  };
  const allow = () => props.onAllow({ model: state.model, ...state.settings });
  const allowDisabled = () => props.submitting || cost() === null;
  const defaultDisabled = () => props.submitting || state.savingDefault;
  const durations = () => picked()?.durations ?? [];
  return (
    <UiBlockCard
      class="approval-card media-approval-card"
      status="pending"
      title={title()}
      subtitle={props.offer.prompt}
      busy={props.submitting}
      waiting
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={props.submitting}
            data-cuelume-tap="close"
            data-cuelume-emphasis="normal"
            onClick={props.onDeny}
          >
            {t("prompt.approval.deny")}
          </Button>
          <Show when={canSetDefault()}>
            <DefaultButton isDefault={isDefault()} disabled={defaultDisabled()} onClick={() => void toggleDefault()} />
          </Show>
          <Button size="sm" type="button" class="media-approval-allow" disabled={allowDisabled()} onClick={allow}>
            {t("prompt.approval.allow")}
            <CreditAmount credits={cost()} class="media-approval-price" />
          </Button>
        </>
      }
    >
      <div class="media-approval-panel">
        <div class="media-approval-request">
          <ModelPicker
            models={props.offer.models}
            value={state.model}
            agentModel={props.offer.agentModel}
            agentName={props.agentName}
            defaultModel={state.defaultModel}
            label={modelLabel()}
            settings={state.settings}
            balance={props.offer.balance}
            disabled={props.submitting}
            onChange={chooseModel}
          />
          <Show when={duration()}>
            {(value) => (
              <DurationSelect
                durations={durations()}
                value={value()}
                disabled={props.submitting}
                onChange={(next) => changeSettings({ duration: next })}
              />
            )}
          </Show>
        </div>
        <Show when={picked()}>
          {(model) => (
            <SettingChips
              model={model()}
              settings={state.settings}
              disabled={props.submitting}
              onChange={changeSettings}
            />
          )}
        </Show>
      </div>
    </UiBlockCard>
  );
}
