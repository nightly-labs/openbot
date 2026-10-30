import type { SpeechVoice } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useCSSVariable } from "uniwind";
import { UsageSegments } from "@/features/agents/components/usage-segments";
import { modelCaptureAvailable } from "@/features/chat/components/use-model-dictation";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { DictationLanguageSection } from "../components/dictation-language-section";
import { useVoicePreview } from "../components/use-voice-preview";
import { elevenLabsVoiceParts } from "../model/elevenlabs";
import { clearElevenLabsVoices, loadElevenLabsVoices, useElevenLabsVoices } from "../model/elevenlabs-voices";
import type { ModelDownload, ModelState } from "../model/model-download";
import { parakeetModel, parakeetSupported, useParakeetModel } from "../model/parakeet-model";
import { speechNative } from "../model/speech-native";
import { supertonicModel, useSupertonicModel } from "../model/supertonic-model";
import {
  type RecognitionEngine,
  removeElevenLabsKey,
  saveVoiceSettings,
  useVoiceSettings,
  type VoiceEngine,
} from "../model/voice-settings";

export function supertonicVoiceLabel(voice: SpeechVoice, t: MobileTranslate): string {
  const number = voice.slice(1);
  return voice.startsWith("F")
    ? t("mobile.settings.voice.supertonic.female", { number })
    : t("mobile.settings.voice.supertonic.male", { number });
}

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

/**
 * The choice of what recognizes the user's speech, in a voice conversation and in dictation. The
 * checked row is the choice; Parakeet listens once its model is downloaded, and the phone's
 * recognizer listens until then.
 */
function RecognitionSection({ onError }: { onError: (message: string) => void }) {
  const { t, format } = useText();
  const settings = useVoiceSettings();
  const model = useParakeetModel();
  const mark = useCheckMark();
  const supported = parakeetSupported();
  const parakeetStatus = !supported
    ? t("mobile.settings.voice.recognition.parakeetUnsupported")
    : model.phase === "ready"
      ? t("mobile.settings.voice.recognition.parakeetReady")
      : (downloadStatus(model, t, format.percent) ??
        t("mobile.settings.voice.engine.supertonicMissing", { size: format.fileSize(parakeetModel.bytes) }));
  const choose = (recognition: RecognitionEngine) => {
    // ElevenLabs needs a key first; the key page makes it the recognizer when the key is saved.
    if (recognition === "elevenlabs" && !settings.hasElevenLabsKey) {
      router.push({ pathname: "/settings/elevenlabs-key", params: { use: "recognition" } });
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
      <SettingsRow
        checked={settings.recognition === "parakeet"}
        disclosure={false}
        disabled={!settings.ready || !supported}
        supportingText={parakeetStatus}
        trailing={mark(settings.recognition === "parakeet")}
        onPress={() => choose("parakeet")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.recognition.parakeet")}</Typography.Paragraph>
      </SettingsRow>
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

/** Parakeet's model, below the choice of recognizer while Parakeet is chosen. */
function ParakeetSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useText();
  return (
    <SettingsSection
      title={t("mobile.settings.voice.recognition.parakeet")}
      footer={t("mobile.settings.voice.recognition.parakeetFooter")}
    >
      <ModelRow
        model={parakeetModel}
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

/**
 * Settings > Voice, in two tabs. Listening: what recognizes the user's speech, the phone's
 * recognizer, Parakeet on the phone, or ElevenLabs Scribe. Speaking: the voice that reads replies,
 * Supertonic 3, the default, which runs on the phone as on desktop, or ElevenLabs. Each tab lists its
 * choices with a check mark, and the section below has the settings of the checked choice only.
 */
export function VoiceSettingsScreen() {
  const { t } = useText();
  const preview = useVoicePreview();
  const engine = useVoiceSettings((state) => state.engine);
  const recognition = useVoiceSettings((state) => state.recognition);
  const hasKey = useVoiceSettings((state) => state.hasElevenLabsKey);
  const canRecognize = modelCaptureAvailable();
  // What hears the user, and what reads the replies: one tab each, so the page stays short.
  const [tab, setTab] = useState<"listening" | "speaking">("listening");
  const [error, setError] = useState<string | null>(null);
  const showError = useRef((message: string) => {
    setError(message);
    void haptics.notification("error");
  }).current;
  // The page needs to know whether the model is on the phone before Download can work.
  useEffect(() => {
    if (parakeetModel.useModel.getState().phase === "unknown") parakeetModel.check();
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
  if (!speechNative)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.settings.voice.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const speaking = (
    <>
      <EngineSection onError={showError} />
      {engine === "elevenlabs" && hasKey ? (
        <ElevenLabsSection preview={preview} readsReplies onError={showError} />
      ) : (
        <SupertonicSection preview={preview} onError={showError} />
      )}
    </>
  );
  // An app binary without the speech module's microphone has only the phone's recognizer.
  if (!canRecognize)
    return (
      <SettingsContent>
        {speaking}
        <DictationLanguageSection />
      </SettingsContent>
    );
  return (
    <SettingsContent>
      <UsageSegments
        options={[
          { value: "listening", label: t("mobile.settings.voice.tab.listening") },
          { value: "speaking", label: t("mobile.settings.voice.tab.speaking") },
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
          {recognition === "parakeet" && parakeetSupported() ? <ParakeetSection onError={showError} /> : null}
          {recognition === "elevenlabs" && hasKey ? (
            <ElevenLabsSection preview={preview} readsReplies={false} onError={showError} />
          ) : null}
        </>
      ) : (
        speaking
      )}
      {error || preview.error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error ?? preview.error}
        </Typography.Paragraph>
      ) : null}
    </SettingsContent>
  );
}
