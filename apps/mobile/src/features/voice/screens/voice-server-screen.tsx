import { sameCustomProviderOrigin, type VoiceServerModels, type VoiceServerRoutes } from "@openbot/contracts/ipc";
import { fitVoiceServerRoutes, shortVoiceServerModel } from "@openbot/contracts/voice-server";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import {
  probeVoiceServer,
  removeVoiceServer,
  saveVoiceServer,
  useVoiceServer,
  VoiceServerError,
  voiceServerKeyProblem,
} from "../model/voice-server";
import { saveVoiceSettings } from "../model/voice-settings";

const NO_ROUTES: VoiceServerRoutes = {
  dictation: false,
  speech: false,
  transcriptionModel: null,
  speechModel: null,
  voice: null,
};

/** The example in the empty address field: a Speaches server on the local network. */
const ADDRESS_EXAMPLE = "http://studio.local:8000/v1";
/** OpenAI-style keys start with `sk-`; a local server often needs no key. */
const API_KEY_EXAMPLE = "sk-…";

type Test =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; models: VoiceServerModels }
  | { status: "failed"; field: "address" | "apiKey"; message: string };

/** One choice of a list, with the check mark of the chosen row. */
function ChoiceRows({
  options,
  value,
  disabled,
  format,
  onChoose,
}: {
  options: readonly string[];
  value: string | null;
  disabled: boolean;
  format: (value: string) => string;
  onChoose: (value: string) => void;
}) {
  const accent = String(useCSSVariable("--openbot-accent"));
  return options.map((option) => (
    <SettingsRow
      key={option}
      checked={option === value}
      disclosure={false}
      disabled={disabled}
      trailing={option === value ? <Check size={18} color={accent} strokeWidth={2} /> : null}
      onPress={() => {
        if (option === value) return;
        void haptics.selection();
        onChoose(option);
      }}
    >
      <Typography.Paragraph numberOfLines={1}>{format(option)}</Typography.Paragraph>
    </SettingsRow>
  ));
}

/**
 * The user's own OpenAI-compatible voice server, as the Voice server of the desktop: Speaches,
 * Kokoro-FastAPI or another server with `/audio/transcriptions` and `/audio/speech`. Connect lists
 * what the server has, and the user chooses which of dictation and spoken replies it does, with
 * their models and voice. The key goes to the keychain and never shows again. A route that is on
 * becomes the recognizer or the reply voice when it is saved.
 */
export function VoiceServerScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const saved = useVoiceServer((state) => state.server);
  const hasApiKey = useVoiceServer((state) => state.hasApiKey);
  const [address, setAddress] = useState(saved?.address ?? "");
  const [apiKey, setApiKey] = useState("");
  const [routes, setRoutes] = useState<VoiceServerRoutes>(saved?.routes ?? NO_ROUTES);
  const [test, setTest] = useState<Test>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  usePreventRemove(saving, () => undefined);
  const trimmed = address.trim();
  const keptKey = hasApiKey && saved !== null && sameCustomProviderOrigin(saved.address, trimmed);
  const models = test.status === "found" ? test.models : null;
  const fieldError = (field: "address" | "apiKey") =>
    test.status === "failed" && test.field === field ? test.message : undefined;

  const edit = (change: () => void) => {
    run.current += 1;
    change();
    setTest({ status: "idle" });
  };

  const connect = async () => {
    const current = ++run.current;
    const key = apiKey.trim();
    const problem = voiceServerKeyProblem(key);
    const text = currentText();
    if (problem) {
      setTest({ status: "failed", field: "apiKey", message: text.sourceText(problem) });
      return;
    }
    setTest({ status: "loading" });
    setError(null);
    try {
      const found = await probeVoiceServer(trimmed, key || null);
      if (current !== run.current) return;
      setTest({ status: "found", models: found });
      setRoutes((before) => fitVoiceServerRoutes(before, found));
      void haptics.notification("success");
    } catch (failure) {
      if (current !== run.current) return;
      void haptics.notification("error");
      setTest({
        status: "failed",
        field: failure instanceof VoiceServerError ? failure.field : "address",
        message: text.errorMessage(failure, text.t("mobile.settings.voice.server.probeFailed")),
      });
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveVoiceServer({ address: trimmed, routes }, apiKey.trim() || null);
      // A route that is on is in use from now, as on desktop.
      await saveVoiceSettings({
        ...(routes.dictation ? { recognition: "voice-server" as const } : {}),
        ...(routes.speech ? { engine: "voice-server" as const } : {}),
      });
      void haptics.notification("success");
      setSaving(false);
      router.back();
    } catch {
      void haptics.notification("error");
      setSaving(false);
      setError(t("mobile.settings.voice.server.saveFailed"));
    }
  };

  const remove = () =>
    Alert.alert(t("mobile.settings.voice.server.removeTitle"), t("mobile.settings.voice.server.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: () => {
          void removeVoiceServer().then(
            () => router.back(),
            () => setError(currentText().t("mobile.settings.voice.server.removeFailed")),
          );
        },
      },
    ]);

  const setRoute = (change: Partial<VoiceServerRoutes>) => setRoutes((before) => ({ ...before, ...change }));
  const dark = theme === "dark";
  const disabled = saving || !models;
  const complete =
    (!routes.dictation || routes.transcriptionModel !== null) &&
    (!routes.speech || (routes.speechModel !== null && routes.voice !== null));
  return (
    <SettingsContent>
      <SheetSaveAction
        dirty={models !== null}
        canSave={models !== null && complete}
        pending={saving}
        label={t("common.save")}
        onSave={() => void save()}
      />
      <View className="gap-4">
        <SheetFormField
          label={t("mobile.settings.voice.server.address")}
          placeholder={ADDRESS_EXAMPLE}
          value={address}
          editable={!saving}
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="url"
          hint={t("mobile.settings.voice.server.addressHint")}
          error={fieldError("address")}
          onChangeText={(next) => edit(() => setAddress(next))}
        />
        <SheetFormField
          label={t("mobile.settings.voice.server.apiKey")}
          placeholder={API_KEY_EXAMPLE}
          value={apiKey}
          editable={!saving}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          hint={keptKey ? t("mobile.settings.voice.server.apiKeySaved") : undefined}
          error={fieldError("apiKey")}
          onChangeText={(next) => edit(() => setApiKey(next))}
          onSubmitEditing={() => {
            if (trimmed && !saving) void connect();
          }}
          returnKeyType="go"
        />
      </View>
      <SettingsSection footer={models ? undefined : t("mobile.settings.voice.server.connectFooter")}>
        <SettingsRow
          disclosure={false}
          disabled={!trimmed || saving || test.status === "loading"}
          onPress={() => void connect()}
        >
          <Typography.Paragraph className="text-accent">
            {t(
              test.status === "loading"
                ? "mobile.settings.voice.server.connecting"
                : "mobile.settings.voice.server.connect",
            )}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {models ? (
        <>
          <SettingsSection
            title={t("mobile.settings.voice.server.dictation")}
            footer={models.transcription.length === 0 ? t("mobile.settings.voice.server.missing") : undefined}
          >
            <SettingsRow>
              <SettingsSwitch
                value={routes.dictation}
                disabled={disabled || models.transcription.length === 0}
                label={t("mobile.settings.voice.server.dictation")}
                dark={dark}
                onValueChange={(dictation) => setRoute({ dictation })}
              />
            </SettingsRow>
            {routes.dictation ? (
              <ChoiceRows
                options={models.transcription}
                value={routes.transcriptionModel}
                disabled={disabled}
                format={shortVoiceServerModel}
                onChoose={(transcriptionModel) => setRoute({ transcriptionModel })}
              />
            ) : null}
          </SettingsSection>
          <SettingsSection
            title={t("mobile.settings.voice.server.speech")}
            footer={models.speech.length === 0 ? t("mobile.settings.voice.server.missing") : undefined}
          >
            <SettingsRow>
              <SettingsSwitch
                value={routes.speech}
                disabled={disabled || models.speech.length === 0 || models.voices.length === 0}
                label={t("mobile.settings.voice.server.speech")}
                dark={dark}
                onValueChange={(speech) => setRoute({ speech })}
              />
            </SettingsRow>
            {routes.speech ? (
              <ChoiceRows
                options={models.speech}
                value={routes.speechModel}
                disabled={disabled}
                format={shortVoiceServerModel}
                onChoose={(speechModel) => setRoute({ speechModel })}
              />
            ) : null}
          </SettingsSection>
          {routes.speech ? (
            <SettingsSection title={t("mobile.settings.voice.voice")}>
              <ChoiceRows
                options={models.voices}
                value={routes.voice}
                disabled={disabled}
                format={(voice) => voice}
                onChoose={(voice) => setRoute({ voice })}
              />
            </SettingsSection>
          ) : null}
        </>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {saved ? (
        <SettingsSection footer={t("mobile.settings.voice.server.footer")}>
          <SettingsRow disclosure={false} disabled={saving} onPress={remove}>
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.settings.voice.server.remove")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : (
        <SettingsNote>{t("mobile.settings.voice.server.footer")}</SettingsNote>
      )}
    </SettingsContent>
  );
}
