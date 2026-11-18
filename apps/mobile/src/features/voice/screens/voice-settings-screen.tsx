import { type CodexLiveVoice, cloudSpeechModel, SPEECH_SPEEDS, type SpeechVoice } from "@openbot/contracts/ipc";
import { shortVoiceServerModel, voiceServerHost } from "@openbot/contracts/voice-server";
import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import { isRunningInExpoGo } from "expo";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { UsageSegments } from "@/features/agents/components/usage-segments";
import { modelCaptureAvailable } from "@/features/chat/components/use-model-dictation";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { DictationLanguageSection } from "../components/dictation-language-section";
import { GptLiveServerRows } from "../components/gpt-live-servers";
import { PauseSlider } from "../components/pause-slider";
import { useVoicePreview } from "../components/use-voice-preview";
import { elevenLabsVoiceParts } from "../model/elevenlabs";
import { clearElevenLabsVoices, loadElevenLabsVoices, useElevenLabsVoices } from "../model/elevenlabs-voices";
import { liveVoiceWebRtc } from "../model/live-voice-webrtc";
import type { ModelDownload, ModelState } from "../model/model-download";
import {
  checkRecognitionModels,
  isLocalRecognition,
  type LocalRecognition,
  localModelOf,
  localRecognitionInBinary,
  localRecognitionSupported,
  useParakeetModel,
  useParakeetUnifiedModel,
  useQwenModel,
} from "../model/recognition-models";
import { canChangeReplySpeed } from "../model/reply-voice";
import { speechNative } from "../model/speech-native";
import { supertonicModel, useSupertonicModel } from "../model/supertonic-model";
import { useVoiceServer } from "../model/voice-server";
import {
  ELEVENLABS_SPEECH_MODEL_IDS,
  type ElevenLabsSpeechModelId,
  type RecognitionEngine,
  removeElevenLabsKey,
  saveVoiceSettings,
  TURN_PAUSE_LIMITS,
  turnPauseMs,
  useVoiceSettings,
  type VoiceEngine,
} from "../model/voice-settings";

export function supertonicVoiceLabel(voice: SpeechVoice, t: MobileTranslate): string {
  const number = voice.slice(1);
  return voice.startsWith("F")
    ? t("mobile.settings.voice.supertonic.female", { number })
    : t("mobile.settings.voice.supertonic.male", { number });
}

/** A GPT live voice by its own name, the same in every language; null is OpenAI's choice. */
export function gptLiveVoiceLabel(voice: CodexLiveVoice | null, t: MobileTranslate): string {
  return voice ? voice.charAt(0).toUpperCase() + voice.slice(1) : t("mobile.settings.voice.gptLive.automatic");
}

/**
 * Expo Go has no speech module, so voice does not work there. In development the page still shows
 * all its sections, so its layout can be checked without a native build. The choices save, and the
 * downloads and samples stay off.
 */
const layoutPreview = __DEV__ && isRunningInExpoGo();

/** A model that downloads or failed to: its progress or its failure. Null when it is ready or missing. */
function downloadStatus(model: ModelState, t: MobileTranslate, percent: (value: number) => string): string | null {
  if (model.phase === "downloading")
    return t("mobile.settings.voice.supertonic.downloading", { percent: percent(model.progress) });
  if (model.phase === "error")
    return t(
      model.failure === "verify"
        ? "mobile.settings.voice.supertonic.verifyFailed"
        : "mobile.settings.voice.supertonic.downloadFailed",
    );
  return null;
}

/** What Supertonic 3 can do now, for its row in the choice of voice. */
function useSupertonicStatus(): string {
  const { t, format } = useText();
  const model = useSupertonicModel();
  const voice = useVoiceSettings((state) => state.supertonicVoice);
  if (model.phase === "ready")
    return t("mobile.settings.voice.engine.supertonicReady", { voice: supertonicVoiceLabel(voice, t) });
  return (
    downloadStatus(model, t, format.percent) ??
    t("mobile.settings.voice.engine.supertonicMissing", { size: format.fileSize(supertonicModel.bytes) })
  );
}

/** The check mark of the chosen row, in the accent colour, as in the other settings lists. */
function useCheckMark() {
  const accent = String(useCSSVariable("--openbot-accent"));
  return (checked: boolean) => (checked ? <Check size={18} color={accent} strokeWidth={2} /> : null);
}

/** The text of each recognizer that runs on the phone: its name, its ready status and its footer. */
const LOCAL_RECOGNITION_TEXT = {
  parakeet: {
    name: "mobile.settings.voice.recognition.parakeet",
    ready: "mobile.settings.voice.recognition.parakeetReady",
    footer: "mobile.settings.voice.recognition.parakeetFooter",
  },
  "parakeet-unified": {
    name: "mobile.settings.voice.recognition.parakeetUnified",
    ready: "mobile.settings.voice.recognition.parakeetUnifiedReady",
    footer: "mobile.settings.voice.recognition.parakeetUnifiedFooter",
  },
  "qwen3-asr": {
    name: "mobile.settings.voice.recognition.qwen",
    ready: "mobile.settings.voice.recognition.qwenReady",
    footer: "mobile.settings.voice.recognition.qwenFooter",
  },
} as const satisfies Record<LocalRecognition, Record<"name" | "ready" | "footer", MobileTextKey>>;

/**
 * The status line of a row of a model on the phone: too little memory, ready, the download, or the
 * download size.
 */
function useLocalModelStatus(engine: LocalRecognition): string {
  const { t, format } = useText();
  const models = {
    parakeet: useParakeetModel(),
    "parakeet-unified": useParakeetUnifiedModel(),
    "qwen3-asr": useQwenModel(),
  };
  const model = models[engine];
  if (!localRecognitionSupported(engine)) return t("mobile.settings.voice.recognition.parakeetUnsupported");
  if (model.phase === "ready") return t(LOCAL_RECOGNITION_TEXT[engine].ready);
  return (
    downloadStatus(model, t, format.percent) ??
    t("mobile.settings.voice.engine.supertonicMissing", { size: format.fileSize(localModelOf(engine).bytes) })
  );
}

/**
 * The choice of what recognizes the user's speech, in a voice conversation and in dictation. The
 * checked row is the choice; a model on the phone listens once it is downloaded, and the phone's
 * recognizer listens until then. An app binary from before Qwen3-ASR does not show it.
 */
function RecognitionSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useText();
  const settings = useVoiceSettings();
  const mark = useCheckMark();
  const statuses = {
    parakeet: useLocalModelStatus("parakeet"),
    "parakeet-unified": useLocalModelStatus("parakeet-unified"),
    "qwen3-asr": useLocalModelStatus("qwen3-asr"),
  };
  const localEngines = (["parakeet", "parakeet-unified", "qwen3-asr"] as const).filter(
    (engine) => localRecognitionInBinary(engine) || layoutPreview,
  );
  const server = useVoiceServer((state) => state.server);
  const choose = (recognition: RecognitionEngine) => {
    // ElevenLabs needs a key first; the key page makes it the recognizer when the key is saved.
    if (recognition === "elevenlabs" && !settings.hasElevenLabsKey) {
      router.push({ pathname: "/settings/elevenlabs-key", params: { use: "recognition" } });
      return;
    }
    // The voice server needs its dictation first; saving it makes it the recognizer.
    if (recognition === "voice-server" && !server?.routes.dictation) {
      router.push("/settings/voice-server");
      return;
    }
    if (recognition === settings.recognition) return;
    void haptics.selection();
    void saveVoiceSettings({ recognition }).catch(() => onError(t("mobile.settings.saveFailed")));
  };
  return (
    <SettingsSection
      title={t("mobile.settings.voice.recognition.title")}
      footer={t("mobile.settings.voice.recognition.footer")}
    >
      <SettingsRow
        checked={settings.recognition === "system"}
        disclosure={false}
        disabled={!settings.ready}
        supportingText={t("mobile.settings.voice.recognition.systemHint")}
        trailing={mark(settings.recognition === "system")}
        onPress={() => choose("system")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.recognition.system")}</Typography.Paragraph>
      </SettingsRow>
      {localEngines.map((engine) => (
        <SettingsRow
          key={engine}
          checked={settings.recognition === engine}
          disclosure={false}
          disabled={!settings.ready || (!localRecognitionSupported(engine) && !layoutPreview)}
          supportingText={statuses[engine]}
          trailing={mark(settings.recognition === engine)}
          onPress={() => choose(engine)}
        >
          <Typography.Paragraph>{t(LOCAL_RECOGNITION_TEXT[engine].name)}</Typography.Paragraph>
        </SettingsRow>
      ))}
      <SettingsRow
        checked={settings.recognition === "elevenlabs"}
        disclosure={false}
        disabled={!settings.ready}
        supportingText={t(
          settings.hasElevenLabsKey
            ? "mobile.settings.voice.recognition.elevenLabsHint"
            : "mobile.settings.voice.engine.elevenLabsNoKey",
        )}
        trailing={mark(settings.recognition === "elevenlabs")}
        onPress={() => choose("elevenlabs")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.recognition.elevenLabs")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        checked={settings.recognition === "voice-server"}
        disclosure={false}
        disabled={!settings.ready}
        supportingText={
          server?.routes.dictation
            ? t("mobile.settings.voice.server.dictationReady", {
                model: shortVoiceServerModel(server.routes.transcriptionModel),
              })
            : t("mobile.settings.voice.server.dictationOff")
        }
        trailing={mark(settings.recognition === "voice-server")}
        onPress={() => choose("voice-server")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.server.choice")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * The user's own OpenAI-compatible voice server, as on desktop. Its page sets the address, the key
 * and what the server does. While it reads the replies, a sample plays here.
 */
function VoiceServerSection({ preview }: { preview?: ReturnType<typeof useVoicePreview> }) {
  const { t } = useText();
  const server = useVoiceServer((state) => state.server);
  const voice = server?.routes.speech ? server.routes.voice : null;
  return (
    <SettingsSection title={t("mobile.settings.voice.server.title")} footer={t("mobile.settings.voice.server.footer")}>
      <SettingsRow
        supportingText={server ? voiceServerHost(server.address) : t("mobile.settings.voice.server.notSetUp")}
        onPress={() => router.push("/settings/voice-server")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.server.row")}</Typography.Paragraph>
      </SettingsRow>
      {preview && voice ? (
        <ListenRow
          enabled
          playing={preview.playing === "settings"}
          onPress={() => preview.toggle("settings", { engine: "voice-server", voice })}
        />
      ) : null}
    </SettingsSection>
  );
}

/** The download, cancel and removal of one model, with its size and progress. */
function ModelRow({
  model,
  label,
  removeTitle,
  removeBody,
  onRemove,
  onError,
}: {
  model: ModelDownload;
  label: string;
  removeTitle: string;
  removeBody: string;
  /** Runs before the files go, such as to stop a sample that plays. */
  onRemove?: () => void;
  onError: (message: string) => void;
}) {
  const { t, format } = useText();
  const state = model.useModel();
  const size = format.fileSize(model.bytes);
  const status =
    state.phase === "ready"
      ? t("mobile.settings.voice.supertonic.ready", { size })
      : (downloadStatus(state, t, format.percent) ?? t("mobile.settings.voice.supertonic.missing", { size }));
  const remove = () =>
    Alert.alert(removeTitle, removeBody, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.settings.voice.supertonic.remove"),
        style: "destructive",
        onPress: () => {
          onRemove?.();
          void model.remove().catch(() => onError(currentText().t("mobile.settings.voice.removeFailed")));
        },
      },
    ]);
  const action =
    state.phase === "downloading" ? (
      <Button size="sm" variant="secondary" onPress={model.cancel}>
        <Button.Label>{t("common.cancel")}</Button.Label>
      </Button>
    ) : state.phase === "ready" ? (
      <Button size="sm" variant="secondary" onPress={remove}>
        <Button.Label className="text-danger-text">{t("mobile.settings.voice.supertonic.remove")}</Button.Label>
      </Button>
    ) : (
      <Button
        size="sm"
        variant="secondary"
        isDisabled={state.phase === "unknown"}
        onPress={() => void model.download()}
      >
        <Button.Label>{t("mobile.settings.voice.supertonic.download")}</Button.Label>
      </Button>
    );
  return (
    <SettingsRow supportingText={status} trailing={action}>
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

/**
 * How long a voice conversation waits for new words before it sends the words. The slider moves in
 * half seconds, natively on iOS; the choice is saved when the finger lifts.
 */
function TurnPauseSection({ onError }: { onError: (message: string) => void }) {
  const { t, format } = useText();
  const ready = useVoiceSettings((state) => state.ready);
  const saved = useVoiceSettings((state) => state.turnPauseMs);
  const [dragged, setDragged] = useState<number | null>(null);
  const shown = dragged ?? saved;
  // The slider can report more than one value before the next render: a step plays one tick.
  const lastStep = useRef(shown);
  const seconds = (milliseconds: number) =>
    t("mobile.settings.voice.pause.seconds", { seconds: format.number(milliseconds / 1_000) });
  return (
    <SettingsSection title={t("mobile.settings.voice.pause.title")} footer={t("mobile.settings.voice.pause.footer")}>
      <View className="gap-3 px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Typography.Paragraph>{t("mobile.settings.voice.pause.label")}</Typography.Paragraph>
          <Typography.Paragraph className="text-grouped-secondary">{seconds(shown)}</Typography.Paragraph>
        </View>
        <PauseSlider
          value={shown}
          minimum={TURN_PAUSE_LIMITS.minimum}
          maximum={TURN_PAUSE_LIMITS.maximum}
          step={TURN_PAUSE_LIMITS.step}
          disabled={!ready}
          label={t("mobile.settings.voice.pause.label")}
          onChange={(value) => {
            const next = turnPauseMs(value);
            if (next === lastStep.current) return;
            lastStep.current = next;
            void haptics.selection();
            setDragged(next);
          }}
          onChangeEnd={(value) => {
            const next = turnPauseMs(value);
            lastStep.current = next;
            setDragged(null);
            if (next === saved) return;
            void saveVoiceSettings({ turnPauseMs: next }).catch(() => onError(t("mobile.settings.saveFailed")));
          }}
        />
      </View>
    </SettingsSection>
  );
}

/** The speed of the replies that are read aloud, also in a voice conversation. */
function ReplySpeedSection({ onError }: { onError: (message: string) => void }) {
  const { t, format } = useText();
  const ready = useVoiceSettings((state) => state.ready);
  const speed = useVoiceSettings((state) => state.speed);
  const title = t("mobile.settings.voice.speed.title");
  return (
    <View className="gap-2">
      <Typography type="body-xs" className="px-4 text-grouped-secondary">
        {title}
      </Typography>
      <UsageSegments
        options={SPEECH_SPEEDS.map((value) => ({
          value: String(value),
          label: t("mobile.settings.voice.speed.value", { speed: format.number(value) }),
        }))}
        value={String(speed)}
        disabled={!ready}
        accessibilityLabel={title}
        onChange={(next) => {
          const chosen = SPEECH_SPEEDS.find((value) => String(value) === next);
          if (chosen === undefined) return;
          void saveVoiceSettings({ speed: chosen }).catch(() => onError(t("mobile.settings.saveFailed")));
        }}
      />
      <Typography.Paragraph type="body-xs" className="px-4 text-grouped-secondary">
        {t("mobile.settings.voice.speed.footer")}
      </Typography.Paragraph>
    </View>
  );
}

/** The model of the chosen recognizer on the phone, below the choice of recognizer. */
function LocalModelSection({ engine, onError }: { engine: LocalRecognition; onError: (message: string) => void }) {
  const { t } = useText();
  return (
    <SettingsSection title={t(LOCAL_RECOGNITION_TEXT[engine].name)} footer={t(LOCAL_RECOGNITION_TEXT[engine].footer)}>
      <ModelRow
        key={engine}
        model={localModelOf(engine)}
        label={t("mobile.settings.voice.recognition.model")}
        removeTitle={t("mobile.settings.voice.recognition.removeTitle")}
        removeBody={t("mobile.settings.voice.recognition.removeBody")}
        onError={onError}
      />
    </SettingsSection>
  );
}

/**
 * The choice of the voice that reads replies. The checked row is the voice in use; the settings of
 * that voice follow below it.
 */
function EngineSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useText();
  const settings = useVoiceSettings();
  const supertonicStatus = useSupertonicStatus();
  const server = useVoiceServer((state) => state.server);
  const checkMark = useCheckMark();
  const mark = (engine: VoiceEngine) => checkMark(settings.engine === engine);
  const elevenLabsStatus = !settings.hasElevenLabsKey
    ? t("mobile.settings.voice.engine.elevenLabsNoKey")
    : settings.elevenLabsVoice
      ? elevenLabsVoiceParts(settings.elevenLabsVoice.name).title
      : t("mobile.settings.voice.elevenLabs.chooseVoice");
  const choose = (engine: VoiceEngine) => {
    // ElevenLabs needs a key first; the key page makes it the voice in use when the key is saved.
    if (engine === "elevenlabs" && !settings.hasElevenLabsKey) {
      router.push("/settings/elevenlabs-key");
      return;
    }
    // The voice server needs its spoken replies first; saving it makes it the voice in use.
    if (engine === "voice-server" && !server?.routes.speech) {
      router.push("/settings/voice-server");
      return;
    }
    if (engine === settings.engine) return;
    void haptics.selection();
    void saveVoiceSettings({ engine }).catch(() => onError(t("mobile.settings.saveFailed")));
  };
  return (
    <SettingsSection title={t("mobile.settings.voice.engine.title")} footer={t("mobile.settings.voice.engine.footer")}>
      <SettingsRow
        checked={settings.engine === "supertonic"}
        disclosure={false}
        disabled={!settings.ready}
        supportingText={supertonicStatus}
        trailing={mark("supertonic")}
        onPress={() => choose("supertonic")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.engine.supertonic")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        checked={settings.engine === "elevenlabs"}
        disclosure={false}
        disabled={!settings.ready}
        supportingText={elevenLabsStatus}
        trailing={mark("elevenlabs")}
        onPress={() => choose("elevenlabs")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.engine.elevenLabs")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        checked={settings.engine === "voice-server"}
        disclosure={false}
        disabled={!settings.ready}
        supportingText={
          server?.routes.speech
            ? t("mobile.settings.voice.server.speechReady", {
                model: shortVoiceServerModel(server.routes.speechModel),
                voice: server.routes.voice ?? "",
              })
            : t("mobile.settings.voice.server.speechOff")
        }
        trailing={mark("voice-server")}
        onPress={() => choose("voice-server")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.server.choice")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

function ListenRow({ enabled, playing, onPress }: { enabled: boolean; playing: boolean; onPress: () => void }) {
  const { t } = useText();
  return (
    <SettingsRow disclosure={false} disabled={!enabled} onPress={onPress}>
      <Typography.Paragraph className="text-accent">
        {t(playing ? "mobile.settings.voice.stop" : "mobile.settings.voice.listen")}
      </Typography.Paragraph>
    </SettingsRow>
  );
}

function SupertonicSection({
  preview,
  onError,
}: {
  preview: ReturnType<typeof useVoicePreview>;
  onError: (message: string) => void;
}) {
  const { t } = useText();
  const modelReady = useSupertonicModel((state) => state.phase === "ready");
  const voice = useVoiceSettings((state) => state.supertonicVoice);
  return (
    <SettingsSection
      title={t("mobile.settings.voice.supertonic.title")}
      footer={t("mobile.settings.voice.supertonic.footer")}
    >
      <ModelRow
        model={supertonicModel}
        label={t("mobile.settings.voice.supertonic.model")}
        removeTitle={t("mobile.settings.voice.supertonic.removeTitle")}
        removeBody={t("mobile.settings.voice.supertonic.removeBody")}
        onRemove={preview.stop}
        onError={onError}
      />
      <SettingsRow
        supportingText={supertonicVoiceLabel(voice, t)}
        onPress={() => router.push({ pathname: "/settings/voice-choice", params: { engine: "supertonic" } })}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.voice")}</Typography.Paragraph>
      </SettingsRow>
      <ListenRow
        enabled={modelReady}
        playing={preview.playing === "settings"}
        onPress={() => preview.toggle("settings", { engine: "supertonic", supertonicVoice: voice })}
      />
    </SettingsSection>
  );
}

function ElevenLabsSection({
  preview,
  readsReplies,
  onError,
}: {
  preview: ReturnType<typeof useVoicePreview>;
  /** ElevenLabs reads the replies, so its voice settings show; else only the key does. */
  readsReplies: boolean;
  onError: (message: string) => void;
}) {
  const { t } = useText();
  const voice = useVoiceSettings((state) => state.elevenLabsVoice);
  const remove = () =>
    Alert.alert(t("mobile.settings.voice.elevenLabs.removeTitle"), t("mobile.settings.voice.elevenLabs.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.settings.voice.elevenLabs.removeKey"),
        style: "destructive",
        onPress: () => {
          preview.stop();
          clearElevenLabsVoices();
          void removeElevenLabsKey().catch(() => onError(currentText().t("mobile.settings.voice.removeFailed")));
        },
      },
    ]);
  return (
    <SettingsSection
      title={t("mobile.settings.voice.elevenLabs.title")}
      footer={t(
        readsReplies ? "mobile.settings.voice.elevenLabs.footer" : "mobile.settings.voice.elevenLabs.recognitionFooter",
      )}
    >
      <SettingsRow
        supportingText={t("mobile.settings.voice.elevenLabs.keySaved")}
        onPress={() => router.push("/settings/elevenlabs-key")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.elevenLabs.key")}</Typography.Paragraph>
      </SettingsRow>
      {readsReplies ? (
        <>
          <SettingsRow
            supportingText={
              voice ? elevenLabsVoiceParts(voice.name).title : t("mobile.settings.voice.elevenLabs.chooseVoice")
            }
            onPress={() => router.push({ pathname: "/settings/voice-choice", params: { engine: "elevenlabs" } })}
          >
            <Typography.Paragraph>{t("mobile.settings.voice.voice")}</Typography.Paragraph>
          </SettingsRow>
          <ListenRow
            enabled={voice !== null}
            playing={preview.playing === "settings"}
            onPress={() => {
              if (voice) preview.toggle("settings", { engine: "elevenlabs", elevenLabsVoice: voice });
            }}
          />
        </>
      ) : null}
      <SettingsRow disclosure={false} onPress={remove}>
        <Typography.Paragraph className="text-danger-text">
          {t("mobile.settings.voice.elevenLabs.removeKey")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

const ELEVENLABS_MODEL_HINT = {
  "elevenlabs-flash-v2.5": "mobile.settings.voice.elevenLabs.model.flash",
  "elevenlabs-multilingual-v2": "mobile.settings.voice.elevenLabs.model.multilingual",
  "elevenlabs-v3": "mobile.settings.voice.elevenLabs.model.v3",
  "elevenlabs-v4-turbo": "mobile.settings.voice.elevenLabs.model.v4Turbo",
  "elevenlabs-v4": "mobile.settings.voice.elevenLabs.model.v4",
} as const satisfies Record<ElevenLabsSpeechModelId, MobileTextKey>;

/** The ElevenLabs model that reads replies, with the same choices as desktop. */
function ElevenLabsModelSection({ onChange, onError }: { onChange: () => void; onError: (message: string) => void }) {
  const { t } = useText();
  const ready = useVoiceSettings((state) => state.ready);
  const chosen = useVoiceSettings((state) => state.elevenLabsModel);
  const mark = useCheckMark();
  const choose = (elevenLabsModel: ElevenLabsSpeechModelId) => {
    if (elevenLabsModel === chosen) return;
    void haptics.selection();
    // A sample of the model before it does not go on.
    onChange();
    void saveVoiceSettings({ elevenLabsModel }).catch(() => onError(t("mobile.settings.saveFailed")));
  };
  return (
    <SettingsSection
      title={t("mobile.settings.voice.elevenLabs.model.title")}
      footer={t("mobile.settings.voice.elevenLabs.model.footer")}
    >
      {ELEVENLABS_SPEECH_MODEL_IDS.map((id) => (
        <SettingsRow
          key={id}
          checked={chosen === id}
          disclosure={false}
          disabled={!ready}
          supportingText={t(ELEVENLABS_MODEL_HINT[id])}
          trailing={mark(chosen === id)}
          onPress={() => choose(id)}
        >
          <Typography.Paragraph>{cloudSpeechModel(id)?.name ?? id}</Typography.Paragraph>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

/**
 * GPT live voice, in three sections: the switch, its voice, and whether each server can run it. It
 * shows only in an app binary with WebRTC; a server without `live-voice-v1` keeps the conversation
 * of the phone.
 */
function GptLiveSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const ready = useVoiceSettings((state) => state.ready);
  const enabled = useVoiceSettings((state) => state.gptLive);
  const voice = useVoiceSettings((state) => state.gptLiveVoice);
  return (
    <>
      <SettingsSection footer={t("mobile.settings.voice.gptLive.footer")}>
        <SettingsRow>
          <SettingsSwitch
            value={enabled}
            disabled={!ready}
            label={t("mobile.settings.voice.gptLive.title")}
            dark={theme === "dark"}
            onValueChange={(gptLive) =>
              void saveVoiceSettings({ gptLive }).catch(() => onError(t("mobile.settings.saveFailed")))
            }
          />
        </SettingsRow>
      </SettingsSection>
      {enabled ? (
        <>
          <SettingsSection>
            <SettingsRow
              supportingText={gptLiveVoiceLabel(voice, t)}
              onPress={() => router.push({ pathname: "/settings/voice-choice", params: { engine: "gpt-live" } })}
            >
              <Typography.Paragraph>{t("mobile.settings.voice.voice")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection
            title={t("mobile.settings.voice.gptLive.serversTitle")}
            footer={t("mobile.settings.voice.gptLive.serversFooter")}
          >
            <GptLiveServerRows />
          </SettingsSection>
        </>
      ) : null}
    </>
  );
}

/**
 * Settings > Voice, in tabs. Listening: what recognizes the user's speech, the phone's
 * recognizer, Parakeet v3, Parakeet Unified or Qwen3-ASR on the phone, or ElevenLabs Scribe, and the pause that sends the words in a
 * voice conversation. Speaking: the voice that reads replies, Supertonic 3, the default, which runs
 * on the phone as on desktop, or ElevenLabs, and the reply speed. GPT live voice: its switch, its
 * voice and the servers. Each tab lists its choices with a check mark, and the
 * section below has the settings of the checked choice only.
 */
export function VoiceSettingsScreen() {
  const { t } = useText();
  const preview = useVoicePreview();
  const engine = useVoiceSettings((state) => state.engine);
  const recognition = useVoiceSettings((state) => state.recognition);
  const hasKey = useVoiceSettings((state) => state.hasElevenLabsKey);
  const serverSpeaks = useVoiceServer((state) => state.server?.routes.speech === true);
  const canRecognize = modelCaptureAvailable() || layoutPreview;
  // What hears the user, what reads the replies, and GPT live voice: one tab each, so the page stays short.
  const [tab, setTab] = useState<"listening" | "speaking" | "gptLive">("listening");
  const [error, setError] = useState<string | null>(null);
  const showError = useRef((message: string) => {
    setError(message);
    void haptics.notification("error");
  }).current;
  // The page needs to know whether the model is on the phone before Download can work.
  useEffect(() => {
    checkRecognitionModels();
  }, []);
  // The voices of the key load once, so the voice list opens with them.
  useEffect(() => {
    if (hasKey && useElevenLabsVoices.getState().phase === "idle") void loadElevenLabsVoices();
  }, [hasKey]);
  // A sample of the voice before it does not go on under the settings of the other one.
  const stopPreview = useRef(preview.stop);
  stopPreview.current = preview.stop;
  const shownEngine = useRef(engine);
  useEffect(() => {
    if (shownEngine.current === engine) return;
    shownEngine.current = engine;
    stopPreview.current();
  }, [engine]);
  if (!speechNative && !layoutPreview)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.settings.voice.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const speaking = (
    <>
      <EngineSection onError={showError} />
      {engine === "elevenlabs" && hasKey ? (
        <>
          <ElevenLabsSection preview={preview} readsReplies onError={showError} />
          <ElevenLabsModelSection onChange={preview.stop} onError={showError} />
        </>
      ) : engine === "voice-server" && serverSpeaks ? (
        <VoiceServerSection preview={preview} />
      ) : (
        <SupertonicSection preview={preview} onError={showError} />
      )}
      {engine === "voice-server" && serverSpeaks ? null : <VoiceServerSection />}
      {canChangeReplySpeed || layoutPreview ? <ReplySpeedSection onError={showError} /> : null}
    </>
  );
  // GPT live voice needs WebRTC, which only a newer app binary has.
  const gptLive = liveVoiceWebRtc || layoutPreview ? <GptLiveSection onError={showError} /> : null;
  // An app binary without the speech module's microphone has only the phone's recognizer.
  if (!canRecognize)
    return (
      <SettingsContent>
        {speaking}
        <DictationLanguageSection />
        <TurnPauseSection onError={showError} />
        {gptLive}
      </SettingsContent>
    );
  return (
    <SettingsContent>
      <UsageSegments
        options={[
          { value: "listening", label: t("mobile.settings.voice.tab.listening") },
          { value: "speaking", label: t("mobile.settings.voice.tab.speaking") },
          ...(gptLive ? [{ value: "gptLive" as const, label: t("mobile.settings.voice.tab.gptLive") }] : []),
        ]}
        value={tab}
        onChange={(next) => {
          preview.stop();
          setTab(next);
        }}
      />
      {tab === "listening" ? (
        <>
          <RecognitionSection onError={showError} />
          {recognition === "system" ? <DictationLanguageSection /> : null}
          {isLocalRecognition(recognition) && (localRecognitionSupported(recognition) || layoutPreview) ? (
            <LocalModelSection engine={recognition} onError={showError} />
          ) : null}
          {recognition === "elevenlabs" && hasKey ? (
            <ElevenLabsSection preview={preview} readsReplies={false} onError={showError} />
          ) : null}
          <VoiceServerSection />
          <TurnPauseSection onError={showError} />
        </>
      ) : tab === "speaking" ? (
        speaking
      ) : (
        gptLive
      )}
      {error || preview.error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error ?? preview.error}
        </Typography.Paragraph>
      ) : null}
    </SettingsContent>
  );
}
