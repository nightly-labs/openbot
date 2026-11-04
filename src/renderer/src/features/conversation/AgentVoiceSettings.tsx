import { type RealtimeVoiceSettings, realtimeVoiceChoices } from "@openbot/contracts/ipc";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text } from "@openbot/ui";
import { SettingsLinkGroup } from "@openbot/ui/components/SettingsPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, Show } from "solid-js";
import { useSettings } from "../settings/settings-context";

/** The host owns both the default and each agent override. No provider identity changes here. */
export function AgentVoiceSettings(props: { agentId: string; serverId?: string }) {
  const { t, errorMessage } = useText();
  const { openAppSettings } = useSettings();
  const [state, setState] = createStore<{
    settings: RealtimeVoiceSettings | null;
    busy: boolean;
    error: string | null;
  }>({ settings: null, busy: false, error: null });
  let generation = 0;
  createEffect(
    () => ({ agentId: props.agentId, serverId: props.serverId }),
    ({ agentId, serverId }) => {
      const own = ++generation;
      setState(() => ({ settings: null, busy: false, error: null }));
      void window.openbot.voice
        .getRealtimeSettings({ agentId }, serverId)
        .then((settings) => {
          if (own === generation)
            setState((s) => {
              s.settings = settings;
            });
        })
        .catch(() => {});
      return () => {
        generation++;
      };
    },
  );
  const label = (voice: string) =>
    voice === "default"
      ? t("settings.voice.realtime.useDefault", {
          voice: (state.settings?.defaultVoice ?? "").replace(/^./, (value) => value.toUpperCase()),
        })
      : voice.charAt(0).toUpperCase() + voice.slice(1);
  async function save(value: string) {
    const own = generation;
    setState((s) => {
      s.busy = true;
      s.error = null;
    });
    try {
      const settings = await window.openbot.voice.setRealtimeVoice(
        { agentId: props.agentId, voice: value === "default" ? null : value },
        props.serverId,
      );
      if (own === generation)
        setState((s) => {
          s.settings = settings;
        });
    } catch (error) {
      if (own === generation)
        setState((s) => {
          s.error = errorMessage(error, t("agentSettings.saveFailed"));
        });
    } finally {
      if (own === generation)
        setState((s) => {
          s.busy = false;
        });
    }
  }
  return (
    <SettingsLinkGroup inset class="agent-settings-runtime-rows" title={t("settings.voice.realtime.section")}>
      <div class="agent-session-setting">
        <Select<string>
          options={["default", ...realtimeVoiceChoices(state.settings?.model ?? "gpt-live-1-codex")]}
          value={state.settings?.voice ?? "default"}
          disabled={state.busy || !state.settings?.configured || !state.settings?.canManage}
          onChange={(value) => {
            if (value !== null) void save(value);
          }}
          itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
        >
          <SelectTrigger class="agent-settings-runtime-row" aria-label={t("settings.voice.realtime.agentVoice")}>
            <span class="agent-settings-runtime-label">{t("settings.voice.realtime.agentVoice")}</span>
            <SelectValue<string>>{(value) => label(value.selectedOption() ?? "default")}</SelectValue>
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>
      <div class="agent-session-setting-notes">
        <Text tone="muted">
          {t(
            state.settings?.configured
              ? "settings.voice.realtime.agentDescription"
              : "settings.voice.realtime.subscription",
          )}
        </Text>
        <Button variant="link" onClick={() => openAppSettings(null, "voice")}>
          {t("settings.voice.realtime.setupLink")}
        </Button>
      </div>
      <Show when={state.error}>{(error) => <Text role="alert">{error()}</Text>}</Show>
    </SettingsLinkGroup>
  );
}
