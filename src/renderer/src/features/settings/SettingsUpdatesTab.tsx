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
} from "../../components/ui";
import type { GeneralSettingsValue } from "./app-settings";
import type { SettingsUpdatesStore } from "./stores/updates-store";

type UpdateTrack = "Stable";
const updateTrackOptions: UpdateTrack[] = ["Stable"];

interface SettingsUpdatesTabProps {
  store: SettingsUpdatesStore;
  value: GeneralSettingsValue;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  /** The dialog element the Select popover portals into, captured when this tab was created. */
  selectMount: HTMLElement | undefined;
}

export function SettingsUpdatesTab(props: SettingsUpdatesTabProps) {
  return (
    <SettingsSection title="OpenBot updates">
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row settings-modal-update-track-row">
          <ItemContent>
            <ItemTitle>Update track</ItemTitle>
            <ItemDescription>Stable receives tested OpenBot releases.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select<UpdateTrack>
              class="settings-modal-update-track-select"
              options={updateTrackOptions}
              value="Stable"
              onChange={() => undefined}
              placement="bottom-end"
              itemComponent={(selectProps) => (
                <SelectItem item={selectProps.item}>{selectProps.item.rawValue}</SelectItem>
              )}
            >
              <SelectTrigger size="sm" aria-label="Update track">
                <SelectValue<UpdateTrack>>{(state) => state.selectedOption()}</SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.selectMount} />
            </Select>
          </ItemActions>
        </Item>
        <Item class="settings-modal-row settings-modal-update-row">
          <ItemContent>
            <ItemTitle>Version {props.store.installedVersion()}</ItemTitle>
            <ItemDescription>Updates follow the Stable track.</ItemDescription>
            <ItemDescription class={props.store.messageClass()}>{props.store.message()}</ItemDescription>
          </ItemContent>
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
              {props.store.presentation().supported ? props.store.presentation().actionLabel : "Updates unavailable"}
            </Button>
          </ItemActions>
        </Item>
        <SwitchField
          checked={props.value.autoDownloadUpdates}
          onChange={(checked) => props.onUpdateSetting("autoDownloadUpdates", checked)}
          label="Automatically download updates"
          description="Download new versions when they become available."
        />
      </ItemGroup>
    </SettingsSection>
  );
}
