import { SPEECH_VOICES } from "@openbot/contracts/ipc";
import { Stack, useLocalSearchParams } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import Play from "lucide-react-native/icons/play";
import Square from "lucide-react-native/icons/square";
import { useEffect } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useVoicePreview } from "../components/use-voice-preview";
import { elevenLabsVoiceParts } from "../model/elevenlabs";
import { loadElevenLabsVoices, useElevenLabsVoices } from "../model/elevenlabs-voices";
import type { ReplyVoiceChoice } from "../model/reply-voice";
import { useSupertonicModel } from "../model/supertonic-model";
import { saveVoiceSettings, useVoiceSettings } from "../model/voice-settings";
import { supertonicVoiceLabel } from "./voice-settings-screen";

interface VoiceOption {
  id: string;
  title: string;
  description: string | null;
  selected: boolean;
  choice: ReplyVoiceChoice;
  select: () => Promise<void>;
}

/** Play or Stop for one voice. It is apart from the row, so a press plays the voice and does not choose it. */
function PreviewButton({
  label,
  playing,
  disabled,
  onPress,
}: {
  label: string;
  playing: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const [foreground] = useThemeColor(["foreground"]);
  return (
    <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={label} isDisabled={disabled} onPress={onPress}>
      {playing ? (
        <Square color={String(foreground)} fill={String(foreground)} size={14} />
      ) : (
        <Play color={String(foreground)} fill={String(foreground)} size={16} />
      )}
    </Button>
  );
}

/**
 * The voices of one engine, as a list: a long ElevenLabs name such as "George - Warm, Captivating
 * Storyteller" shows its description on its own line instead of pushing the row apart. A press
 * chooses the voice; the button at the end plays a sample of it.
 */
export function VoiceChoiceScreen() {
  const { t } = useText();
  const { engine } = useLocalSearchParams<{ engine?: string }>();
  const elevenLabs = engine === "elevenlabs";
  const settings = useVoiceSettings();
  const modelReady = useSupertonicModel((state) => state.phase === "ready");
  const voices = useElevenLabsVoices();
  const preview = useVoicePreview();
  const accent = String(useCSSVariable("--openbot-accent"));
  useEffect(() => {
    if (elevenLabs && settings.hasElevenLabsKey && useElevenLabsVoices.getState().phase !== "ready")
      void loadElevenLabsVoices();
  }, [elevenLabs, settings.hasElevenLabsKey]);

  const options: VoiceOption[] = elevenLabs
    ? voices.voices.map((voice) => ({
        id: voice.id,
        ...elevenLabsVoiceParts(voice.name),
        selected: settings.elevenLabsVoice?.id === voice.id,
        choice: { engine: "elevenlabs", elevenLabsVoice: voice },
        select: () => saveVoiceSettings({ elevenLabsVoice: voice }),
      }))
    : SPEECH_VOICES.map((voice) => ({
        id: voice,
        title: supertonicVoiceLabel(voice, t),
        description: null,
        selected: settings.supertonicVoice === voice,
        choice: { engine: "supertonic", supertonicVoice: voice },
        select: () => saveVoiceSettings({ supertonicVoice: voice }),
      }));
  const canPreview = elevenLabs ? settings.hasElevenLabsKey : modelReady;
  const failure =
    voices.failure === "missing-voices-permission"
      ? t("mobile.settings.voice.elevenLabs.missingVoicesPermission")
      : voices.failure === "invalid-key"
        ? t("mobile.chat.liveVoice.elevenLabsKeyInvalid")
        : t("mobile.settings.voice.elevenLabs.voicesFailed");

  return (
    <SettingsContent>
      <Stack.Screen
        options={{
          title: elevenLabs ? t("mobile.settings.voice.elevenLabs.title") : t("mobile.settings.voice.supertonic.title"),
        }}
      />
      {elevenLabs && voices.phase === "loading" && options.length === 0 ? (
        <View className="items-center py-6">
          <Spinner />
        </View>
      ) : elevenLabs && voices.phase === "failed" ? (
        <SettingsNote>{failure}</SettingsNote>
      ) : (
        <SettingsSection
          footer={
            preview.error ??
            (canPreview
              ? t("mobile.settings.voice.choiceFooter")
              : elevenLabs
                ? undefined
                : t("mobile.settings.voice.choiceDownloadFirst"))
          }
        >
          {options.map((option) => (
            <SettingsRow
              key={option.id}
              checked={option.selected}
              disclosure={false}
              supportingText={option.description ?? undefined}
              trailing={
                <View className="flex-row items-center gap-1">
                  {/* A slot of the same width on every row, so the play buttons stay in one column. */}
                  <View className="w-6 items-center">
                    {option.selected ? <Check size={18} color={accent} strokeWidth={2} /> : null}
                  </View>
                  <PreviewButton
                    label={t(
                      preview.playing === option.id
                        ? "mobile.settings.voice.stopVoice"
                        : "mobile.settings.voice.playVoice",
                      {
                        name: option.title,
                      },
                    )}
                    playing={preview.playing === option.id}
                    disabled={!canPreview}
                    onPress={() => preview.toggle(option.id, option.choice)}
                  />
                </View>
              }
              onPress={() => {
                if (option.selected) return;
                void haptics.selection();
                void option.select();
              }}
            >
              <Typography.Paragraph>{option.title}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}
    </SettingsContent>
  );
}
