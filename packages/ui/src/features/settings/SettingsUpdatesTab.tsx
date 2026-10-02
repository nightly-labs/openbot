import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Clock3,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  SwitchField,
} from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { restartReasonKey } from "../updates/restart-reasons";
import type { GeneralSettingsValue } from "./app-settings";
import type { SettingsUpdatesStore } from "./stores/updates-store";

type UpdateTrack = "Stable";
const updateTrackOptions: UpdateTrack[] = ["Stable"];
const UPDATE_TRACK_LABELS = { Stable: "settings.updates.track.stable" } as const satisfies Record<
  UpdateTrack,
  AppTextKey
>;

interface SettingsUpdatesTabProps {
  store: SettingsUpdatesStore;
  value: GeneralSettingsValue;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  /** The dialog element the Select popover portals into, captured when this tab was created. */
  selectMount: HTMLElement | undefined;
}

export function SettingsUpdatesTab(props: SettingsUpdatesTabProps) {
  const { t, format, errorMessage } = useText();
  const managed = () => props.store.presentation().managed;
  const idleRestartWaitingFor = (reasons: readonly string[]) =>
    t("update.idleRestart.waitingFor", { reasons: format.list(reasons.map((reason) => t(restartReasonKey(reason)))) });

  return (
    <SettingsSection title={t("settings.updates.title")}>
      <Show when={props.store.scheduledRestart()}>
        {(restart) => (
          <Alert tone="neutral" role="status">
            <AlertIcon>
              <Clock3 />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>
                {restart().requestedBy === null
                  ? t("update.scheduled.automaticTitle")
                  : t("update.scheduled.title", { name: restart().requestedBy ?? "" })}
              </AlertTitle>
              <AlertDescription>
                {restart().mode === "now" ? t("update.scheduled.now") : t("update.scheduled.whenIdle")}
              </AlertDescription>
            </AlertContent>
            <AlertActions>
              <Button
                variant="outline"
                type="button"
                size="sm"
                loading={props.store.cancelling()}
                onClick={() => void props.store.cancelScheduledRestart()}
              >
                {t("update.scheduled.cancel")}
              </Button>
            </AlertActions>
          </Alert>
        )}
      </Show>
      <Show when={props.store.idleRestart()}>
        {(restart) => (
          <Alert tone={restart().error === undefined ? "neutral" : "danger"} role="status">
            <AlertIcon>
              <Clock3 />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>
                {restart().error !== undefined
                  ? t("update.idleRestart.failedTitle")
                  : restart().target === "update"
                    ? t("update.idleRestart.updateTitle")
                    : t("update.idleRestart.relaunchTitle")}
              </AlertTitle>
              <AlertDescription>
                {restart().error !== undefined
                  ? errorMessage(restart().error, t("update.idleRestart.failedTitle"))
                  : t("update.idleRestart.description")}
              </AlertDescription>
              <Show when={restart().error === undefined && restart().waitingFor.length > 0}>
                <AlertDescription>{idleRestartWaitingFor(restart().waitingFor)}</AlertDescription>
              </Show>
            </AlertContent>
            <AlertActions>
              <Button
                variant="outline"
                type="button"
                size="sm"
                loading={props.store.idleRestartBusy()}
                onClick={() => void props.store.cancelIdleRestart()}
              >
                {restart().error === undefined ? t("update.idleRestart.cancel") : t("common.close")}
              </Button>
            </AlertActions>
          </Alert>
        )}
      </Show>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row settings-modal-update-track-row">
          <ItemContent>
            <ItemTitle>{t("settings.updates.track.title")}</ItemTitle>
            <ItemDescription>{t("settings.updates.track.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select<UpdateTrack>
              class="settings-modal-update-track-select"
              options={updateTrackOptions}
              value="Stable"
              onChange={() => undefined}
              placement="bottom-end"
              itemComponent={(selectProps) => (
                <SelectItem item={selectProps.item}>{t(UPDATE_TRACK_LABELS[selectProps.item.rawValue])}</SelectItem>
              )}
            >
              <SelectTrigger size="sm" aria-label={t("settings.updates.track.title")}>
                <SelectValue<UpdateTrack>>{(state) => t(UPDATE_TRACK_LABELS[state.selectedOption()])}</SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.selectMount} />
            </Select>
          </ItemActions>
        </Item>
        <Item class="settings-modal-row settings-modal-update-row">
          <ItemContent>
            <ItemTitle>{t("settings.updates.version", { version: props.store.installedVersion() })}</ItemTitle>
            <Show when={!managed()}>
              <ItemDescription>{t("settings.updates.followsStable")}</ItemDescription>
            </Show>
            <ItemDescription class={props.store.messageClass()}>{props.store.message()}</ItemDescription>
          </ItemContent>
          {/* The host installs the shared application itself, so a tenant has no action to take. */}
          <Show when={!managed()}>
            <ItemActions class="settings-modal-update-actions">
              <Button
                variant="outline"
                type="button"
                size="sm"
                loading={props.store.presentation().busy}
                loadingLabel={props.store.presentation().actionLabel}
                disabled={!props.store.presentation().supported}
                onClick={() => void props.store.runAction()}
              >
                {props.store.presentation().supported
                  ? props.store.presentation().actionLabel
                  : t("settings.updates.unavailable")}
              </Button>
            </ItemActions>
          </Show>
        </Item>
        <Show when={props.store.idleRestartOffered()}>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("settings.updates.idleRestart.title")}</ItemTitle>
              <ItemDescription>
                {props.store.idleRestartInstalls()
                  ? t("settings.updates.idleRestart.updateDescription", { target: props.store.targetUpdate() })
                  : t("settings.updates.idleRestart.relaunchDescription")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="outline"
                type="button"
                size="sm"
                loading={props.store.idleRestartBusy()}
                disabled={props.store.idleRestart() !== undefined && props.store.idleRestart()?.error === undefined}
                onClick={() => void props.store.restartWhenIdle()}
              >
                {props.store.idleRestartInstalls()
                  ? t("settings.updates.idleRestart.update")
                  : t("settings.updates.idleRestart.relaunch")}
              </Button>
            </ItemActions>
          </Item>
        </Show>
        <Show
          when={managed()}
          fallback={
            <>
              <SwitchField
                checked={props.value.autoDownloadUpdates}
                onChange={(checked) => props.onUpdateSetting("autoDownloadUpdates", checked)}
                label={t("settings.updates.autoDownload.title")}
                description={t("settings.updates.autoDownload.description")}
              />
              <SwitchField
                checked={props.value.autoInstallUpdates}
                onChange={(checked) => props.onUpdateSetting("autoInstallUpdates", checked)}
                label={t("settings.updates.autoInstall.title")}
                description={t("settings.updates.autoInstall.description")}
              />
              <SwitchField
                checked={props.value.allowRemoteUpdates}
                onChange={(checked) => props.onUpdateSetting("allowRemoteUpdates", checked)}
                label={t("settings.updates.allowRemote.title")}
                description={t("settings.updates.allowRemote.description")}
              />
            </>
          }
        >
          {/* Host management is machine state an administrator owns. Report it; never offer it. */}
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("settings.updates.managed.title")}</ItemTitle>
              <ItemDescription>{t("settings.updates.managed.description")}</ItemDescription>
            </ItemContent>
          </Item>
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}
