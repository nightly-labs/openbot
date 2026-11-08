import {
  type SpeechModelStatus,
  VOICE_KEY_PROVIDER_NAMES,
  type VoiceKeyProvider,
  type VoiceModelStatus,
} from "@openbot/contracts/ipc";
import {
  Button,
  Download,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Progress,
  RefreshCw,
  Select,
  SelectContent,
  SelectItem,
  SelectSection,
  SelectTrigger,
  SelectValue,
  TOAST_DURATION,
  toast,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createRoot, createStore, getOwner, onCleanup, runWithOwner, Show, untrack } from "solid-js";

/** Where a model runs: on this computer, or at a provider with the user's own key. */
export type ModelPlace = "local" | VoiceKeyProvider;

const PLACE_ORDER: readonly ModelPlace[] = ["local", "elevenlabs", "groq", "xai"];

export interface ModelChoice<Id extends string> {
  id: Id;
  /** The product name. It is not translated. */
  name: string;
  place: ModelPlace;
}

interface ModelGroup<Id extends string> {
  place: ModelPlace;
  ids: Id[];
}

/** The name under the provider in the menu: the provider name is the group name, so it is not repeated. */
function shortName(choice: ModelChoice<string>): string {
  if (choice.place === "local") return choice.name;
  const provider = `${VOICE_KEY_PROVIDER_NAMES[choice.place]} `;
  return choice.name.startsWith(provider) ? choice.name.slice(provider.length) : choice.name;
}

/** The name on the menu button: the provider name and the model name. */
function fullName(choice: ModelChoice<string>): string {
  if (choice.place === "local") return choice.name;
  const provider = VOICE_KEY_PROVIDER_NAMES[choice.place];
  return choice.name.startsWith(`${provider} `) ? choice.name : `${provider} ${choice.name}`;
}

/** The file of a model on this computer, and its download size. */
export interface ModelFile {
  bytes: number;
  status: VoiceModelStatus | SpeechModelStatus | null;
}

interface VoiceModelRowProps<Id extends string> {
  choices: readonly ModelChoice<Id>[];
  value: Id | null;
  onChoose: (id: Id) => void;
  description: string;
  /** A second line, such as "the voice server takes dictation". */
  note?: string | undefined;
  /** The file of the chosen model, or null for a cloud model. */
  file: ModelFile | null;
  onDownload: () => void;
  onRemove: () => void;
  /** A button before the Download or Remove button, such as Use. */
  action?: JSX.Element | undefined;
  disabled: boolean;
  mount: HTMLElement | undefined;
}

/**
 * The one Model row of a section: a menu with the models, grouped by provider, and one button for
 * the chosen model. A model on this computer has Download, Try again, or Remove; its download shows
 * in a toast. A cloud model has no button: its key row follows.
 */
export function VoiceModelRow<Id extends string>(props: VoiceModelRowProps<Id>) {
  const { t, format, errorMessage } = useText();
  const chosen = () => props.choices.find((choice) => choice.id === props.value);
  const choiceOf = (id: Id) => props.choices.find((choice) => choice.id === id);
  const groups = (): ModelGroup<Id>[] =>
    PLACE_ORDER.map((place) => ({
      place,
      ids: props.choices.filter((choice) => choice.place === place).map((choice) => choice.id),
    })).filter((group) => group.ids.length > 0);
  const groupName = (place: ModelPlace) =>
    place === "local" ? t("settings.voice.model.group.local") : VOICE_KEY_PROVIDER_NAMES[place];
  const phase = () => props.file?.status?.phase;
  const fileText = (): string | null => {
    const file = props.file;
    if (!file) return null;
    if (file.status?.phase === "downloading") return t("settings.voice.model.downloadingShort");
    if (file.status?.phase === "error") return errorMessage(file.status.message, t("settings.voice.model.failed"));
    if (file.status?.phase === "missing") return t("settings.voice.model.size", { size: format.fileSize(file.bytes) });
    return null;
  };
  const name = () => chosen()?.name ?? "";
  return (
    <Item data-settings-row="settings.voice.model.title" class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{t("settings.voice.model.title")}</ItemTitle>
        <ItemDescription>{props.description}</ItemDescription>
        <Show when={props.note}>{(note) => <ItemDescription>{note()}</ItemDescription>}</Show>
        <Show when={fileText()}>{(text) => <ItemDescription aria-live="polite">{text()}</ItemDescription>}</Show>
      </ItemContent>
      <ItemActions>
        <div class="settings-voice-model-actions">
          {props.action}
          <Show when={phase() === "missing"}>
            <Button
              variant="outline"
              size="sm"
              type="button"
              aria-label={t("settings.voice.model.downloadLabel", { name: name() })}
              onClick={() => props.onDownload()}
            >
              <Download size={14} aria-hidden="true" />
              {t("common.download")}
            </Button>
          </Show>
          <Show when={phase() === "error"}>
            <Button
              variant="outline"
              size="sm"
              type="button"
              aria-label={t("settings.voice.model.retryLabel", { name: name() })}
              onClick={() => props.onDownload()}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t("common.tryAgain")}
            </Button>
          </Show>
          <Show when={phase() === "ready"}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              aria-label={t("settings.voice.model.removeLabel", { name: name() })}
              onClick={() => props.onRemove()}
            >
              {t("common.remove")}
            </Button>
          </Show>
          <Select<Id, ModelGroup<Id>>
            class="settings-modal-select settings-modal-link-select"
            options={groups()}
            optionGroupChildren="ids"
            value={props.value}
            onChange={(next) => next && next !== props.value && props.onChoose(next)}
            disabled={props.disabled}
            placement="bottom-end"
            sameWidth={false}
            sectionComponent={(sectionProps) => (
              <SelectSection>{groupName(sectionProps.section.rawValue.place)}</SelectSection>
            )}
            itemComponent={(selectProps) => (
              <SelectItem item={selectProps.item}>{modelShortName(choiceOf(selectProps.item.rawValue))}</SelectItem>
            )}
          >
            <SelectTrigger size="sm" aria-label={t("settings.voice.model.title")}>
              <SelectValue<Id>>{(state) => modelFullName(choiceOf(state.selectedOption()))}</SelectValue>
            </SelectTrigger>
            <SelectContent mount={props.mount} />
          </Select>
        </div>
      </ItemActions>
    </Item>
  );
}

function modelShortName(choice: ModelChoice<string> | undefined): string {
  return choice ? shortName(choice) : "";
}

function modelFullName(choice: ModelChoice<string> | undefined): string {
  return choice ? fullName(choice) : "";
}

interface VoiceKeyRowProps {
  provider: VoiceKeyProvider;
  saved: boolean;
  /** Saves the key. The answer is false when main could not save it. */
  onSave: (key: string) => Promise<boolean>;
  onRemove: () => void;
}

/**
 * The key row of a cloud model, under the Model row. With no key, the row says so in the warning
 * color and has the key field; Save key shows when the field has text. With a key, it has Remove key.
 * The key is never read back: main has no getter for it, and the field clears once it is saved.
 */
export function VoiceKeyRow(props: VoiceKeyRowProps) {
  const { t } = useText();
  const [key, setKey] = createStore({ draft: "", saving: false });
  const provider = () => VOICE_KEY_PROVIDER_NAMES[props.provider];
  const label = () => t("settings.voice.apiKey.providerLabel", { provider: provider() });
  const save = async () => {
    const draft = key.draft.trim();
    if (!draft || key.saving) return;
    setKey((state) => {
      state.saving = true;
    });
    const saved = await props.onSave(draft);
    setKey((state) => {
      state.saving = false;
      if (saved) state.draft = "";
    });
  };
  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{label()}</ItemTitle>
        <Show when={!props.saved}>
          <ItemDescription class="settings-voice-needs-key">
            {t("settings.voice.apiKey.needed", { provider: provider() })}
          </ItemDescription>
        </Show>
      </ItemContent>
      <ItemActions>
        <div class="settings-voice-model-actions">
          <Show
            when={props.saved}
            fallback={
              <>
                <Show when={key.draft.trim()}>
                  <Button variant="outline" size="sm" type="button" disabled={key.saving} onClick={() => void save()}>
                    {t("settings.voice.apiKey.save")}
                  </Button>
                </Show>
                <div class="settings-modal-link-select settings-voice-key-field">
                  <Input
                    type="password"
                    size="sm"
                    autocomplete="off"
                    spellcheck={false}
                    aria-label={label()}
                    placeholder={t("settings.voice.apiKey.placeholder")}
                    value={key.draft}
                    disabled={key.saving}
                    onValueChange={(value) =>
                      setKey((state) => {
                        state.draft = value;
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void save();
                    }}
                  />
                </div>
              </>
            }
          >
            <Button
              variant="ghost"
              size="sm"
              type="button"
              aria-label={t("settings.voice.apiKey.removeLabel", { provider: provider() })}
              onClick={() => props.onRemove()}
            >
              {t("settings.voice.apiKey.remove")}
            </Button>
          </Show>
        </div>
      </ItemActions>
    </Item>
  );
}

/** A model file that downloads now. */
export interface ModelDownload {
  /** The model ID. It names the toast. */
  id: string;
  name: string;
  progress: number;
  /** True when the download ended with the model on this computer. */
  ready: boolean;
}

interface ModelDownloadToastsProps {
  /** Each model whose file is on its way or was on its way, by model ID. */
  downloads: readonly ModelDownload[];
  /** The IDs of the downloads that run now. */
  running: readonly string[];
  onCancel: (id: string) => void;
}

/** The bar and the percent of one download in its toast. */
function DownloadProgress(props: { name: string; progress: () => number }) {
  const { t, format } = useText();
  return (
    <span class="settings-voice-toast-progress">
      <Progress value={props.progress()} aria-label={t("settings.voice.model.progressLabel", { name: props.name })} />
      <span class="settings-voice-toast-percent">
        {format.percent(props.progress() / 100, { maximumFractionDigits: 0 })}
      </span>
    </span>
  );
}

/**
 * One toast for each model download. It stays open while the file downloads and has Cancel. At the
 * end it changes to "<model> is ready". A cancelled or failed download closes its toast; the Model
 * row shows a failure.
 */
export function ModelDownloadToasts(props: ModelDownloadToastsProps) {
  const { t } = useText();
  const owner = getOwner();
  const open = new Map<string, () => void>();
  const cancelled = new Set<string>();
  const toastId = (id: string) => `voice-model-${id}`;
  const download = (id: string) => props.downloads.find((entry) => entry.id === id);

  const raise = (id: string) => {
    const name = untrack(() => download(id)?.name ?? id);
    const parts = runWithOwner(owner, () =>
      createRoot((dispose) => ({
        dispose,
        description: <DownloadProgress name={name} progress={() => download(id)?.progress ?? 0} />,
      })),
    );
    open.set(id, parts.dispose);
    toast(t("settings.voice.model.progressLabel", { name }), {
      id: toastId(id),
      duration: Number.POSITIVE_INFINITY,
      closeButton: false,
      description: parts.description,
      action: {
        label: t("common.cancel"),
        onClick: (event: MouseEvent) => {
          // The toast stays until the download ends, so it closes with its status.
          event.preventDefault();
          cancelled.add(id);
          props.onCancel(id);
        },
      },
    });
  };

  const settle = (id: string) => {
    const dispose = open.get(id);
    open.delete(id);
    toast.dismiss(toastId(id));
    const entry = untrack(() => download(id));
    if (!cancelled.has(id) && entry?.ready)
      toast.success(t("settings.voice.model.ready", { name: entry.name }), {
        id: `${toastId(id)}-ready`,
        duration: TOAST_DURATION,
      });
    cancelled.delete(id);
    dispose?.();
  };

  createEffect(
    () => props.running.join(","),
    (joined) => {
      const ids = new Set(joined ? joined.split(",") : []);
      for (const id of ids) if (!open.has(id)) raise(id);
      for (const id of [...open.keys()]) if (!ids.has(id)) settle(id);
    },
  );
  onCleanup(() => {
    for (const [id, dispose] of open) {
      toast.dismiss(toastId(id));
      dispose();
    }
    open.clear();
  });
  return null;
}
