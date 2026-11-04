import type { RealtimeVoiceStatus, ServerSummary } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { serverRoleCanAdminister } from "../servers/server-capabilities";
import { noteRealtimeVoiceStatus } from "../speech/realtime-voice-status";
import { voicePort } from "./voice-port";

export function createRealtimeVoiceSettingsStore(
  active: () => boolean,
  selectedServer: () => ServerSummary | undefined,
) {
  const [state, setState] = createStore<{
    phase: "loading" | "offline" | "unsupported" | "failed" | "ready";
    configured: boolean;
    status: RealtimeVoiceStatus | null;
    busy: boolean;
    canManage: boolean;
    hostName: string;
  }>({ phase: "loading", configured: false, status: null, busy: false, canManage: false, hostName: "" });
  createEffect(
    () => ({ active: active(), server: selectedServer() }),
    ({ active, server }) => {
      if (!active) return;
      const id = server?.id ?? "local";
      const supported =
        !server ||
        server.kind === "local" ||
        server.compatibility?.capabilities.includes("realtime-voice-agent-settings-v1");
      setState((draft) => {
        Object.assign(draft, {
          phase: !supported
            ? "unsupported"
            : server?.kind === "remote" && server.state !== "online"
              ? "offline"
              : "loading",
          configured: false,
          status: null,
          busy: false,
          canManage:
            supported === true &&
            (!server || serverRoleCanAdminister(server)) &&
            (!server || server.kind === "local" || server.state === "online"),
          hostName: server?.name ?? currentText().t("settings.voice.realtime.local"),
        });
      });
      if (!supported || (server?.kind === "remote" && server.state !== "online")) return;
      let alive = true;
      void voicePort()
        .voice.getRealtimeSettings({ agentId: null }, id)
        .then((settings) => {
          const status = { enabled: settings.enabled, model: settings.model, voice: settings.defaultVoice };
          noteRealtimeVoiceStatus(id, status);
          if (alive)
            setState((draft) => {
              draft.phase = "ready";
              draft.status = status;
              draft.configured = settings.configured;
              draft.canManage = draft.canManage && settings.canManage;
            });
        })
        .catch(() => {
          if (alive)
            setState((draft) => {
              draft.phase = "failed";
            });
        });
      return () => {
        alive = false;
      };
    },
  );

  async function setRealtimeEnabled(enabled: boolean): Promise<void> {
    if (!state.canManage || state.busy || !state.status) return;
    const id = selectedServer()?.id ?? "local";
    setState((draft) => {
      draft.busy = true;
    });
    try {
      const status = await voicePort().voice.setRealtimeEnabled({ enabled }, id);
      noteRealtimeVoiceStatus(id, status);
      if ((selectedServer()?.id ?? "local") === id)
        setState((draft) => {
          draft.status = status;
        });
    } catch (error) {
      fail(error, "settings.voice.saveFailed");
    } finally {
      if ((selectedServer()?.id ?? "local") === id)
        setState((draft) => {
          draft.busy = false;
        });
    }
  }

  async function setRealtimeDefaultVoice(voice: string): Promise<void> {
    if (!state.canManage || state.busy) return;
    const id = selectedServer()?.id ?? "local";
    setState((s) => {
      s.busy = true;
    });
    try {
      const settings = await voicePort().voice.setRealtimeVoice({ agentId: null, voice }, id);
      const status = { enabled: settings.enabled, model: settings.model, voice: settings.defaultVoice };
      noteRealtimeVoiceStatus(id, status);
      if ((selectedServer()?.id ?? "local") === id)
        setState((s) => {
          s.status = status;
          s.configured = settings.configured;
        });
    } catch (error) {
      fail(error, "settings.voice.saveFailed");
    } finally {
      if ((selectedServer()?.id ?? "local") === id)
        setState((s) => {
          s.busy = false;
        });
    }
  }

  function fail(error: unknown, key: "settings.voice.saveFailed") {
    const { t, errorMessage } = currentText();
    toast.error(errorMessage(error, t(key)));
  }
  return { state, setRealtimeEnabled, setRealtimeDefaultVoice };
}

/** One readiness message is shared by the provider notice and the personal setup entry. */
export function realtimeVoiceSetupKey(state: {
  phase: "loading" | "offline" | "unsupported" | "failed" | "ready";
  configured: boolean;
  status: RealtimeVoiceStatus | null;
}) {
  if (state.phase === "loading") return "settings.voice.realtime.loading";
  if (state.phase === "offline") return "settings.voice.realtime.offline";
  if (state.phase === "unsupported") return "settings.voice.realtime.unsupported";
  if (state.phase === "failed") return "settings.voice.realtime.failed";
  if (!state.configured) return "settings.voice.realtime.requirements";
  return state.status?.enabled ? "settings.voice.realtime.ready" : "settings.voice.realtime.hostOff";
}
