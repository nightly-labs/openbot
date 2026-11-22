import {
  type HostAdminDesktopApi,
  type HostVoiceModel,
  type HostVoiceModelAction,
  isLocalVoiceModelId,
  type LocalVoiceModelId,
  VOICE_MODELS,
} from "@openbot/contracts/ipc";
import { ItemDescription, ItemGroup, SettingsSection } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js";
import {
  MODEL_DESCRIPTION,
  type ModelChoice,
  type ModelDownload,
  ModelDownloadToasts,
  type ModelFile,
  VoiceModelRow,
} from "../settings/VoiceModelRow";

export type HostVoiceModelCalls = Pick<HostAdminDesktopApi, "getVoiceModel" | "changeVoiceModel">;

export interface ServerVoiceModelOptions {
  calls?: HostVoiceModelCalls;
}

const DOWNLOAD_POLL_MS = 1_000;

export function ServerVoiceModelSetting(
  props: ServerVoiceModelOptions & {
    serverId: string;
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage } = useText();
  const calls = (): HostVoiceModelCalls => props.calls ?? window.openbot.hostAdmin;
  const [snapshot, setSnapshot] = createSignal<HostVoiceModel | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  let generation = 0;
  let writeGeneration = 0;

  function load(serverId: string): void {
    const current = ++generation;
    const writes = writeGeneration;
    untrack(calls)
      .getVoiceModel(serverId)
      .then(
        (next) => {
          if (current !== generation || writes !== writeGeneration) return;
          setSnapshot(next);
          setLoadError(null);
        },
        (error: unknown) => {
          if (current === generation) setLoadError(errorMessage(error, t("server.settings.voiceModel.loadFailed")));
        },
      );
  }

  createEffect(
    () => props.serverId,
    (serverId) => {
      setSnapshot(null);
      setLoadError(null);
      load(serverId);
    },
  );

  const status = (modelId: LocalVoiceModelId) => snapshot()?.models.find((model) => model.modelId === modelId) ?? null;
  const selected = (): LocalVoiceModelId | null => {
    const modelId = snapshot()?.modelId;
    return isLocalVoiceModelId(modelId) ? modelId : null;
  };
  const localModels = createMemo(() =>
    VOICE_MODELS.flatMap((model) =>
      model.kind === "local" &&
      (!model.retired || model.id === selected() || (status(model.id)?.phase ?? "missing") !== "missing")
        ? [model]
        : [],
    ),
  );
  const choices = createMemo((): ModelChoice<LocalVoiceModelId>[] =>
    localModels().map((model) => ({ id: model.id, name: model.name, place: "local" })),
  );
  const chosenModel = () => localModels().find((model) => model.id === selected());
  const note = () => {
    const model = chosenModel();
    return model ? t(MODEL_DESCRIPTION[model.id]) : undefined;
  };
  const file = (): ModelFile | null => {
    const model = chosenModel();
    return model ? { bytes: model.bytes, status: status(model.id) } : null;
  };
  const downloads = createMemo((): ModelDownload[] =>
    localModels().flatMap((model) => {
      const current = status(model.id);
      return current
        ? [{ id: model.id, name: model.name, progress: current.progress ?? 0, ready: current.phase === "ready" }]
        : [];
    }),
  );
  const running = createMemo(() =>
    localModels()
      .filter((model) => status(model.id)?.phase === "downloading")
      .map((model): string => model.id),
  );
  const downloading = createMemo(() => running().length > 0);

  createEffect(
    () => (downloading() ? props.serverId : null),
    (serverId) => {
      if (!serverId) return;
      const timer = window.setInterval(() => load(serverId), DOWNLOAD_POLL_MS);
      return () => window.clearInterval(timer);
    },
  );

  function change(action: HostVoiceModelAction, modelId: LocalVoiceModelId): void {
    const serverId = props.serverId;
    const request = ++writeGeneration;
    void props.run("voice-model", async () => {
      const next = await calls().changeVoiceModel({ action, modelId }, serverId);
      if (request === writeGeneration && serverId === props.serverId) setSnapshot(next);
    });
  }

  return (
    <SettingsSection title={t("server.settings.voiceModel.section")}>
      <ItemGroup class="settings-modal-card">
        <Show
          when={snapshot()}
          fallback={
            <Show when={loadError()}>{(message) => <ItemDescription role="alert">{message()}</ItemDescription>}</Show>
          }
        >
          <VoiceModelRow<LocalVoiceModelId>
            choices={choices()}
            value={selected()}
            onChoose={(modelId) => change("select", modelId)}
            description={t("server.settings.voiceModel.description")}
            note={note()}
            file={file()}
            onDownload={() => {
              const modelId = selected();
              if (modelId) change("download", modelId);
            }}
            onRemove={() => {
              const modelId = selected();
              if (modelId) change("remove", modelId);
            }}
            disabled={props.disabled}
            mount={props.menuMount}
            onServer
          />
        </Show>
      </ItemGroup>
      <ModelDownloadToasts
        scope={`server-${props.serverId}`}
        downloads={downloads()}
        running={running()}
        onCancel={(modelId) => {
          if (isLocalVoiceModelId(modelId)) change("cancel", modelId);
        }}
      />
    </SettingsSection>
  );
}
