import type { ServerSummary } from "@openbot/contracts/ipc";
import { Button, SettingsSection, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { createRealtimeVoiceSettingsStore, realtimeVoiceSetupKey } from "../settings/realtime-voice-settings-store";
export function CodexVoiceSetup(props: { server: ServerSummary; onOpen?: (() => void) | undefined }) {
  const { t } = useText();
  const store = createRealtimeVoiceSettingsStore(
    () => true,
    () => props.server,
  );
  return (
    <SettingsSection title={t("settings.voice.realtime.section")}>
      <Text>{t(realtimeVoiceSetupKey(store.state), { server: props.server.name })}</Text>
      <Text>{t("settings.voice.realtime.subscription")}</Text>
      <Show when={props.onOpen}>
        <Button variant="link" onClick={() => props.onOpen?.()}>
          {t("settings.voice.realtime.setupLink")}
        </Button>
      </Show>
    </SettingsSection>
  );
}
