import {
  type HostAdminDesktopApi,
  type HostVoiceModel,
  type HostVoiceModelChange,
  LOCAL_VOICE_MODEL_IDS,
} from "@openbot/contracts/ipc";

export function createMockHostVoiceModel(): Pick<HostAdminDesktopApi, "getVoiceModel" | "changeVoiceModel"> {
  const state: HostVoiceModel = {
    modelId: "parakeet-tdt-0.6b-v3",
    models: LOCAL_VOICE_MODEL_IDS.map((modelId) => ({ modelId, phase: "missing", progress: null, message: null })),
  };
  const snapshot = (): HostVoiceModel => ({
    modelId: state.modelId,
    models: state.models.map((model) => ({ ...model })),
  });
  const apply = ({ action, modelId }: HostVoiceModelChange) => {
    if (action === "select") {
      state.modelId = modelId;
      return;
    }
    const model = state.models.find((entry) => entry.modelId === modelId);
    if (!model) return;
    model.phase = action === "download" ? "ready" : "missing";
    model.progress = action === "download" ? 100 : null;
  };
  return {
    getVoiceModel: async () => snapshot(),
    changeVoiceModel: async (change) => {
      apply(change);
      return snapshot();
    },
  };
}
