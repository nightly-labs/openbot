import {
  AudioLines,
  Badge,
  Button,
  ConfirmDialog,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Progress,
  SettingsSection,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";

/** The speech model that voice input uses. Names are product names and stay untranslated. */
export interface VoiceModelInfo {
  name: string;
  publisher: string;
  languageCount: number;
  sizeBytes: number;
}

export type VoiceModelState =
  | { phase: "missing" }
  | { phase: "downloading"; receivedBytes: number }
  /** `memoryBytes` is null while the model is not loaded. */
  | { phase: "installed"; memoryBytes: number | null }
  | { phase: "failed"; message: string };

/** Model files that an earlier version left on disk. */
export interface OlderVoiceModel {
  id: string;
  name: string;
  sizeBytes: number;
}

export interface SettingsVoiceTabProps {
  model: VoiceModelInfo;
  state: VoiceModelState;
  /** How long the loaded model stays in memory without use. */
  idleUnloadMinutes: number;
  /** The folder that holds the model files. */
  location: string;
  olderModels: readonly OlderVoiceModel[];
  onDownload: () => void;
  /** A returned promise keeps the confirmation open until it settles. */
  onRemove: () => void | Promise<void>;
  onUnload: () => void;
  onReveal: () => void;
  onRemoveOlder: (id: string) => void;
}

export function SettingsVoiceTab(props: SettingsVoiceTabProps): JSX.Element {
  const { t, format } = useText();
  const [confirmingRemove, setConfirmingRemove] = createSignal(false);
  const installed = () => (props.state.phase === "installed" ? props.state : undefined);
  const downloading = () => (props.state.phase === "downloading" ? props.state : undefined);
  const failed = () => (props.state.phase === "failed" ? props.state : undefined);

  async function remove(): Promise<void> {
    await props.onRemove();
    setConfirmingRemove(false);
  }

  return (
    <>
      <SettingsSection title={t("settings.voice.title")} description={t("settings.voice.description")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemMedia>
              <span class="settings-voice-model-icon">
                <AudioLines aria-hidden="true" />
              </span>
            </ItemMedia>
            <ItemContent>
              <ItemTitle class="settings-voice-model-title">
                <span>{props.model.name}</span>
                <Switch>
                  <Match when={installed()}>
                    <Badge size="sm" variant="success-light">
                      {t("settings.voice.model.installed")}
                    </Badge>
                  </Match>
                  <Match when={downloading()}>
                    <Badge size="sm" variant="info-light">
                      {t("settings.voice.model.downloading")}
                    </Badge>
                  </Match>
                  <Match when={failed()}>
                    <Badge size="sm" variant="destructive-light">
                      {t("settings.voice.model.failed")}
                    </Badge>
                  </Match>
                  <Match when={props.state.phase === "missing"}>
                    <Badge size="sm" variant="outline">
                      {t("settings.voice.model.notInstalled")}
                    </Badge>
                  </Match>
                </Switch>
              </ItemTitle>
              <ItemDescription>
                {t("settings.voice.model.summary", {
                  publisher: props.model.publisher,
                  languages: String(props.model.languageCount),
                  size: format.fileSize(props.model.sizeBytes),
                })}
              </ItemDescription>
              <Switch>
                <Match when={downloading()}>
                  {(state) => (
                    <div class="settings-voice-progress">
                      <Progress
                        value={state().receivedBytes}
                        maxValue={props.model.sizeBytes}
                        aria-label={t("settings.voice.model.downloading")}
                      />
                      <ItemDescription>
                        {t("settings.voice.model.progress", {
                          received: format.fileSize(state().receivedBytes),
                          total: format.fileSize(props.model.sizeBytes),
                        })}
                      </ItemDescription>
                    </div>
                  )}
                </Match>
                <Match when={failed()}>
                  {(state) => <ItemDescription class="settings-voice-error">{state().message}</ItemDescription>}
                </Match>
                <Match when={props.state.phase === "missing"}>
                  <ItemDescription>{t("settings.voice.model.missingHint")}</ItemDescription>
                </Match>
              </Switch>
            </ItemContent>
            <ItemActions>
              <Switch>
                <Match when={installed()}>
                  <Button variant="outline" size="sm" type="button" onClick={() => setConfirmingRemove(true)}>
                    {t("common.remove")}
                  </Button>
                </Match>
                <Match when={failed()}>
                  <Button size="sm" type="button" onClick={() => props.onDownload()}>
                    {t("common.tryAgain")}
                  </Button>
                </Match>
                <Match when={props.state.phase === "missing"}>
                  <Button size="sm" type="button" onClick={() => props.onDownload()}>
                    {t("common.download")}
                  </Button>
                </Match>
              </Switch>
            </ItemActions>
          </Item>
          <Show when={installed()}>
            {(state) => (
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.voice.memory.title")}</ItemTitle>
                  <ItemDescription>
                    <Show when={state().memoryBytes} fallback={t("settings.voice.memory.idle")}>
                      {(memoryBytes) =>
                        t("settings.voice.memory.loaded", {
                          size: format.fileSize(memoryBytes()),
                          minutes: String(props.idleUnloadMinutes),
                        })
                      }
                    </Show>
                  </ItemDescription>
                </ItemContent>
                <Show when={state().memoryBytes !== null}>
                  <ItemActions>
                    <Button variant="outline" size="sm" type="button" onClick={() => props.onUnload()}>
                      {t("settings.voice.memory.unload")}
                    </Button>
                  </ItemActions>
                </Show>
              </Item>
            )}
          </Show>
          <Show when={installed()}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("settings.voice.location.title")}</ItemTitle>
                <ItemDescription class="settings-voice-location" title={props.location}>
                  {props.location}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="outline" size="sm" type="button" onClick={() => props.onReveal()}>
                  {t("files.action.reveal")}
                </Button>
              </ItemActions>
            </Item>
          </Show>
        </ItemGroup>
      </SettingsSection>
      <Show when={props.olderModels.length > 0}>
        <SettingsSection title={t("settings.voice.older.title")} description={t("settings.voice.older.description")}>
          <ItemGroup class="settings-modal-card">
            <For each={props.olderModels}>
              {(older) => (
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemTitle>{older.name}</ItemTitle>
                    <ItemDescription>{format.fileSize(older.sizeBytes)}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button variant="outline" size="sm" type="button" onClick={() => props.onRemoveOlder(older.id)}>
                      {t("common.remove")}
                    </Button>
                  </ItemActions>
                </Item>
              )}
            </For>
          </ItemGroup>
        </SettingsSection>
      </Show>
      <ConfirmDialog
        open={confirmingRemove()}
        onCancel={() => setConfirmingRemove(false)}
        onConfirm={remove}
        title={t("settings.voice.remove.title")}
        description={t("settings.voice.remove.description", { size: format.fileSize(props.model.sizeBytes) })}
        confirmLabel={t("common.remove")}
        pendingLabel={t("settings.voice.remove.pending")}
      />
    </>
  );
}
