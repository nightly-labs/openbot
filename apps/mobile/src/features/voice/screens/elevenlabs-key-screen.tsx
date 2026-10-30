import { router, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Linking, View } from "react-native";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { ElevenLabsError, testElevenLabsKey } from "../model/elevenlabs";
import { useElevenLabsVoices } from "../model/elevenlabs-voices";
import { saveElevenLabsKey, saveVoiceSettings, useVoiceSettings } from "../model/voice-settings";

/** The longest API key the phone accepts, as desktop does for its ElevenLabs key. */
const KEY_MAX_LENGTH = 512;
const KEYS_PAGE = "https://elevenlabs.io/app/developers/api-keys";

const FAILURES = {
  "invalid-key": "mobile.chat.liveVoice.elevenLabsKeyInvalid",
  "missing-voices-permission": "mobile.settings.voice.elevenLabs.missingVoicesPermission",
  "missing-speech-permission": "mobile.settings.voice.elevenLabs.missingSpeechPermission",
  "missing-transcription-permission": "mobile.chat.dictation.elevenLabsPermission",
  network: "mobile.chat.liveVoice.networkNeeded",
  failed: "mobile.settings.voice.elevenLabs.testFailed",
} as const;

/**
 * The ElevenLabs API key. The page lists the permissions that a restricted key needs, and the phone
 * tests two of them before it saves the key: it lists the voices (Voices: Read) and reads one
 * character (Text to Speech: Access). Speech to Text is tested when the first dictation starts, as
 * a test would cost a recognition session. The key goes to the keychain and never shows again. A new
 * key takes the first voice of the account when none is chosen, and makes ElevenLabs the voice in
 * use, or the recognizer when the page opened from the choice of recognizer.
 */
export function ElevenLabsKeyScreen() {
  const { t } = useText();
  const { use } = useLocalSearchParams<{ use?: string }>();
  const [key, setKey] = useState("");
  const [state, setState] = useState<{ phase: "idle" | "saving"; error: string | null }>({
    phase: "idle",
    error: null,
  });
  const saving = state.phase === "saving";
  usePreventRemove(saving, () => undefined);
  const trimmed = key.trim();

  const save = async () => {
    setState({ phase: "saving", error: null });
    try {
      const voices = await testElevenLabsKey(trimmed);
      await saveElevenLabsKey(trimmed);
      useElevenLabsVoices.setState({ phase: "ready", voices, failure: null });
      const chosen = useVoiceSettings.getState().elevenLabsVoice;
      const kept = chosen && voices.some((voice) => voice.id === chosen.id) ? chosen : (voices[0] ?? null);
      await saveVoiceSettings(
        use === "recognition"
          ? { recognition: "elevenlabs", elevenLabsVoice: kept }
          : { engine: "elevenlabs", elevenLabsVoice: kept },
      );
      void haptics.notification("success");
      setState({ phase: "idle", error: null });
      router.back();
    } catch (error) {
      void haptics.notification("error");
      setState({
        phase: "idle",
        error: t(error instanceof ElevenLabsError ? FAILURES[error.code] : "mobile.settings.saveFailed"),
      });
    }
  };

  return (
    <SettingsContent>
      <SheetSaveAction
        dirty={Boolean(trimmed)}
        canSave={trimmed.length > 0 && trimmed.length <= KEY_MAX_LENGTH}
        pending={saving}
        label={t("mobile.settings.voice.elevenLabs.saveKey")}
        pendingLabel={t("mobile.settings.voice.elevenLabs.testing")}
        onSave={() => void save()}
      />
      <View className="gap-2">
        <SheetFormField
          label={t("mobile.settings.voice.elevenLabs.key")}
          placeholder={t("mobile.settings.voice.elevenLabs.keyPlaceholder")}
          value={key}
          editable={!saving}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          maxLength={KEY_MAX_LENGTH}
          hint={t("mobile.settings.voice.elevenLabs.keyHint")}
          onChangeText={setKey}
          onSubmitEditing={() => {
            if (trimmed && !saving) void save();
          }}
          returnKeyType="done"
        />
        {state.error ? (
          <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
            {state.error}
          </Typography.Paragraph>
        ) : null}
      </View>
      <SettingsSection
        title={t("mobile.settings.voice.elevenLabs.permissionsTitle")}
        footer={t("mobile.settings.voice.elevenLabs.permissionsFooter")}
      >
        <SettingsRow supportingText={t("mobile.settings.voice.elevenLabs.permissionSpeechHint")}>
          <Typography.Paragraph>{t("mobile.settings.voice.elevenLabs.permissionSpeech")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow supportingText={t("mobile.settings.voice.elevenLabs.permissionVoicesHint")}>
          <Typography.Paragraph>{t("mobile.settings.voice.elevenLabs.permissionVoices")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow supportingText={t("mobile.settings.voice.elevenLabs.permissionTranscriptionHint")}>
          <Typography.Paragraph>{t("mobile.settings.voice.elevenLabs.permissionTranscription")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection footer={t("mobile.settings.voice.elevenLabs.footer")}>
        <SettingsRow onPress={() => void Linking.openURL(KEYS_PAGE).catch(() => undefined)}>
          <Typography.Paragraph>{t("mobile.settings.voice.elevenLabs.getKey")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
