import {
  type HostVoiceModel,
  type HostVoiceModelChange,
  isLocalVoiceModelId,
  type LocalVoiceModelId,
  type VoiceModelStatus,
  type VoiceSettings,
} from "@openbot/contracts/ipc";
import { Deferred, Effect } from "effect";

type VoiceModelOperation<A> = Effect.Effect<A, { readonly cause: unknown }>;
type VoiceModelListener = (status: VoiceModelStatus) => void;

export interface VoiceModels {
  getModelStatuses(): VoiceModelOperation<VoiceModelStatus[]>;
  getSettings(): VoiceSettings;
  setSettings(settings: VoiceSettings): VoiceModelOperation<VoiceSettings>;
  downloadModel(modelId: LocalVoiceModelId): VoiceModelOperation<VoiceModelStatus>;
  cancelModelDownload(modelId: LocalVoiceModelId): VoiceModelOperation<VoiceModelStatus>;
  removeModel(modelId: LocalVoiceModelId): VoiceModelOperation<VoiceModelStatus>;
  on(event: "modelStatus", listener: VoiceModelListener): void;
  off(event: "modelStatus", listener: VoiceModelListener): void;
}

export class HostVoiceModelService {
  readonly #voice: VoiceModels;

  constructor(voice: VoiceModels) {
    this.#voice = voice;
  }

  readonly snapshot = Effect.fn("HostVoiceModel.snapshot")(function* (this: HostVoiceModelService) {
    const statuses = yield* this.#voice.getModelStatuses();
    return {
      modelId: this.#voice.getSettings().modelId,
      models: statuses.filter((status) => isLocalVoiceModelId(status.modelId)),
    } satisfies HostVoiceModel;
  }).bind(this);

  readonly change = Effect.fn("HostVoiceModel.change")(function* (
    this: HostVoiceModelService,
    { action, modelId }: HostVoiceModelChange,
  ) {
    if (action === "select") yield* this.#voice.setSettings({ ...this.#voice.getSettings(), modelId });
    else if (action === "download") yield* this.#download(modelId);
    else if (action === "cancel") yield* this.#voice.cancelModelDownload(modelId);
    else yield* this.#voice.removeModel(modelId);
    return yield* this.snapshot();
  }).bind(this);

  #download(modelId: LocalVoiceModelId): VoiceModelOperation<void> {
    return Effect.suspend(() => {
      const started = Deferred.makeUnsafe<void>();
      const listener: VoiceModelListener = (status) => {
        if (status.modelId === modelId && status.phase !== "missing") Deferred.doneUnsafe(started, Effect.void);
      };
      this.#voice.on("modelStatus", listener);
      return Effect.raceFirst(this.#voice.downloadModel(modelId).pipe(Effect.asVoid), Deferred.await(started)).pipe(
        Effect.ensuring(Effect.sync(() => this.#voice.off("modelStatus", listener))),
      );
    });
  }
}
