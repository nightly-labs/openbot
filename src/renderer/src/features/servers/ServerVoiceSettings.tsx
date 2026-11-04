import type { ServerSummary } from "@openbot/contracts/ipc";
import { realtimeVoiceChoices } from "@openbot/contracts/ipc";
import {
  Item,
  ItemActions,
  ItemContent,
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
import { useText } from "@openbot/ui/text";
import { createRealtimeVoiceSettingsStore } from "../settings/realtime-voice-settings-store";

export function ServerVoiceSettings(props: { server: ServerSummary; menuMount: HTMLElement | undefined }) {
  const { t } = useText();
  const store = createRealtimeVoiceSettingsStore(
    () => true,
    () => props.server,
  );
  return (
    <SettingsSection title={t("settings.voice.realtime.section")}>
      <ItemGroup class="settings-modal-card">
        <SwitchField
          data-settings-row="settings.voice.realtime.serverEnabled"
          checked={store.state.status?.enabled ?? false}
          disabled={!store.state.configured || !store.state.status || !store.state.canManage || store.state.busy}
          onChange={(enabled) => void store.setRealtimeEnabled(enabled)}
          label={t("settings.voice.realtime.serverEnabled")}
          description={t(
            store.state.configured
              ? "settings.voice.realtime.serverDescription"
              : "settings.voice.realtime.requirements",
            { server: store.state.hostName },
          )}
        />
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{t("settings.voice.realtime.defaultVoice")}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Select<string>
              class="settings-modal-select"
              options={[...realtimeVoiceChoices(store.state.status?.model ?? "gpt-live-1-codex")]}
              value={store.state.status?.voice ?? null}
              disabled={!store.state.configured || !store.state.canManage || store.state.busy}
              onChange={(voice) => {
                if (voice) void store.setRealtimeDefaultVoice(voice);
              }}
              itemComponent={(item) => (
                <SelectItem item={item.item}>
                  {item.item.rawValue.charAt(0).toUpperCase() + item.item.rawValue.slice(1)}
                </SelectItem>
              )}
            >
              <SelectTrigger size="sm" aria-label={t("settings.voice.realtime.defaultVoice")}>
                <SelectValue<string>>
                  {(value) => {
                    const voice = value.selectedOption();
                    return voice ? voice.charAt(0).toUpperCase() + voice.slice(1) : "";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.menuMount} />
            </Select>
          </ItemActions>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}
