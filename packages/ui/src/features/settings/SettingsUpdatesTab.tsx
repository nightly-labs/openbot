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
  const managed = () => props.store.presentation().managed;

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
            <Show when={!managed()}>
              <ItemDescription>Updates follow the Stable track.</ItemDescription>
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
                {props.store.presentation().supported ? props.store.presentation().actionLabel : "Updates unavailable"}
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
              label="Automatically download updates"
              description="Download new versions when they become available."
            />
          }
        >
          {/* Host management is machine state an administrator owns. Report it; never offer it. */}
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>Managed by Host</ItemTitle>
              <ItemDescription>
                Updates for this Mac are managed automatically by OpenBot Host Manager. All users share the same OpenBot
                application and are updated together when registered users are idle.
              </ItemDescription>
            </ItemContent>
          </Item>
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}
