import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
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
  const { t } = useText();
  const managed = () => props.store.presentation().managed;

  return (
    <SettingsSection title={t("settings.updates.title")}>
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
        <Show
          when={managed()}
          fallback={
            <SwitchField
              checked={props.value.autoDownloadUpdates}
              onChange={(checked) => props.onUpdateSetting("autoDownloadUpdates", checked)}
              label={t("settings.updates.autoDownload.title")}
              description={t("settings.updates.autoDownload.description")}
            />
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
