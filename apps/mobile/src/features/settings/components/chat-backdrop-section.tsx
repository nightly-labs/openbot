import { CHAT_BACKDROP_SCENES, type ChatBackdropScene } from "@openbot/brand/chat-backdrop-scenes";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Typography } from "heroui-native";
import Ban from "lucide-react-native/icons/ban";
import ImageIcon from "lucide-react-native/icons/image";
import Sparkles from "lucide-react-native/icons/sparkles";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { ChatBackdropSceneView } from "@/features/chat/components/chat-backdrop-scene";
import { HtmlPage } from "@/features/chat/components/html-page";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import {
  backdropPhotoFile,
  CHAT_BACKDROP_STRENGTH,
  type ChatBackdropChoice,
  previewChatBackdropStrength,
  saveBackdropPhoto,
  saveChatBackdrop,
  useChatBackdrop,
} from "@/features/settings/model/chat-backdrop";
import { saveMessageColor, useMessageColor } from "@/features/settings/model/message-color";
import { PauseSlider } from "@/features/voice/components/pause-slider";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const SCENE_LABELS = {
  pond: "mobile.settings.appearance.backdrop.pond",
  jellyfish: "mobile.settings.appearance.backdrop.jellyfish",
  sunset: "mobile.settings.appearance.backdrop.sunset",
  snowfall: "mobile.settings.appearance.backdrop.snowfall",
  fireflies: "mobile.settings.appearance.backdrop.fireflies",
} as const satisfies Record<ChatBackdropScene, MobileTextKey>;

const DOT = 28;

function photoExtension(asset: ImagePicker.ImagePickerAsset): string {
  const fromName = /\.([a-z0-9]{2,5})$/iu.exec(asset.fileName ?? asset.uri)?.[1];
  if (fromName) return fromName.toLowerCase();
  return asset.mimeType?.split("/")[1] ?? "jpg";
}

function Dot({ children }: { children: ReactNode }) {
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full border border-border bg-background"
      style={{ width: DOT, height: DOT }}
    >
      {children}
    </View>
  );
}

export function ChatBackdropSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const ready = useChatBackdrop((state) => state.ready);
  const choice = useChatBackdrop((state) => state.choice);
  const strength = useChatBackdrop((state) => state.strength);
  const agentPage = useChatBackdrop((state) => state.agentPage);
  const photo = useChatBackdrop((state) => state.photo);
  const seeThrough = useMessageColor((state) => state.seeThrough);
  const messageColorReady = useMessageColor((state) => state.ready);
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const [error, setError] = useState<string | null>(null);

  const fail = () => {
    setError(t("mobile.settings.saveFailed"));
    void haptics.notification("error");
  };
  const choose = (next: ChatBackdropChoice) => {
    if (next === choice) return;
    setError(null);
    void haptics.selection();
    void saveChatBackdrop({ choice: next }).catch(fail);
  };
  const pickPhoto = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    void haptics.selection();
    await saveBackdropPhoto(new File(asset.uri), photoExtension(asset));
  };

  const options: {
    id: ChatBackdropChoice;
    label: string;
    supportingText?: string;
    leading: ReactNode;
    onPress: () => void;
  }[] = [
    {
      id: "none",
      label: t("mobile.settings.appearance.backdrop.none"),
      leading: (
        <Dot>
          <Ban size={16} color={muted} strokeWidth={2} />
        </Dot>
      ),
      onPress: () => choose("none"),
    },
    ...CHAT_BACKDROP_SCENES.map((scene) => ({
      id: scene,
      label: t(SCENE_LABELS[scene]),
      leading: (
        <Dot>
          <View style={{ width: DOT, height: DOT }}>
            <ChatBackdropSceneView scene={scene} dark={dark} animate={false} />
          </View>
        </Dot>
      ),
      onPress: () => choose(scene),
    })),
    ...(agentPage && HtmlPage
      ? [
          {
            id: "agent" as const,
            label: agentPage.name || t("mobile.settings.appearance.backdrop.agentPage"),
            supportingText: t("mobile.settings.appearance.backdrop.agentPageNote"),
            leading: (
              <Dot>
                <Sparkles size={16} color={muted} strokeWidth={2} />
              </Dot>
            ),
            onPress: () => choose("agent"),
          },
        ]
      : []),
    {
      id: "photo",
      label: t("mobile.settings.appearance.backdrop.photo"),
      supportingText: photo
        ? t("mobile.settings.appearance.backdrop.photoChange")
        : t("mobile.settings.appearance.backdrop.photoChoose"),
      leading: (
        <Dot>
          {photo ? (
            <Image
              source={{ uri: backdropPhotoFile(photo).uri }}
              contentFit="cover"
              style={{ width: DOT, height: DOT }}
            />
          ) : (
            <ImageIcon size={16} color={muted} strokeWidth={2} />
          )}
        </Dot>
      ),
      onPress: () => {
        if (photo && choice !== "photo") choose("photo");
        else void pickPhoto().catch(fail);
      },
    },
  ];

  return (
    <>
      <SettingsSection
        title={t("mobile.settings.appearance.backdrop.title")}
        footer={error ?? t("mobile.settings.appearance.backdrop.footer")}
      >
        {options.map((option) => (
          <SettingsRow
            key={option.id}
            checked={choice === option.id}
            disabled={!ready}
            disclosure={false}
            leading={option.leading}
            supportingText={option.supportingText}
            onPress={option.onPress}
          >
            <Typography.Paragraph>{option.label}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection footer={t("mobile.settings.appearance.backdrop.strengthFooter")}>
        <View className="gap-2 px-4 py-3">
          <PauseSlider
            value={strength}
            minimum={CHAT_BACKDROP_STRENGTH.min}
            maximum={CHAT_BACKDROP_STRENGTH.max}
            step={0.05}
            disabled={!ready || choice === "none"}
            label={t("mobile.settings.appearance.backdrop.strength")}
            onChange={previewChatBackdropStrength}
            onChangeEnd={(next) => {
              void saveChatBackdrop({ strength: next }).catch(fail);
            }}
          />
          <View className="flex-row justify-between">
            <Typography type="body-xs" className="text-grouped-secondary">
              {t("mobile.settings.appearance.backdrop.calm")}
            </Typography>
            <Typography type="body-xs" className="text-grouped-secondary">
              {t("mobile.settings.appearance.backdrop.vivid")}
            </Typography>
          </View>
        </View>
      </SettingsSection>
      <SettingsSection footer={t("mobile.settings.appearance.seeThroughBubblesNote")}>
        <SettingsRow>
          <SettingsSwitch
            value={seeThrough}
            disabled={!messageColorReady || choice === "none"}
            label={t("mobile.settings.appearance.seeThroughBubbles")}
            dark={dark}
            onValueChange={(next) => {
              setError(null);
              void saveMessageColor({ seeThrough: next }).catch(fail);
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
