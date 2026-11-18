import { CHAT_BACKDROP_SCENES, type ChatBackdropScene } from "@openbot/brand/chat-backdrop-scenes";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useIsFocused } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Ban from "lucide-react-native/icons/ban";
import ImageIcon from "lucide-react-native/icons/image";
import Sparkles from "lucide-react-native/icons/sparkles";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { ChatBackdropLayer, useChatBackdropBase } from "@/features/chat/components/chat-backdrop-layer";
import { ChatBackdropSceneView } from "@/features/chat/components/chat-backdrop-scene";
import { HtmlPage } from "@/features/chat/components/html-page";
import { readableOn } from "@/features/onboarding/model/onboarding-colors";
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
import {
  mixColor,
  PLAIN_BUBBLE_SHARE,
  saveMessageColor,
  tintedMessageColor,
  useMessageColor,
} from "@/features/settings/model/message-color";
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

/** The size of the round picture of each choice. */
const DOT = 28;
/** The height of the preview: a question and the start of a reply. */
const PREVIEW_HEIGHT = 196;

/** The file extension of a picked photo, from its name or type. */
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

/**
 * A short chat over the backdrop, so the strength, the bubble color and See-through bubbles show
 * before the reader opens a chat. It uses the same layer as the chat.
 */
function BackdropPreview({ active }: { active: boolean }) {
  const { t } = useText();
  const dark = useUniwind().theme === "dark";
  const mode = useMessageColor((state) => state.mode);
  const customColor = useMessageColor((state) => state.customColor);
  const style = useMessageColor((state) => state.style);
  const pageColor = useChatBackdrop((state) =>
    state.choice === "agent" ? state.agentPage?.bubbles?.yours : undefined,
  );
  const [surface, control] = useCSSVariable(["--openbot-bg-surface", "--openbot-bg-control"]);
  const seeThrough = useMessageColor((state) => state.seeThrough);
  const background = String(useThemeColor("background"));
  const backdropBase = useChatBackdropBase();
  const base = backdropBase ?? background;
  // A bubble with no color and an agent bubble, as the chat draws them: solid on the backdrop base, or
  // see-through. With no backdrop, bubbles are always solid.
  const plain =
    seeThrough && backdropBase !== null
      ? `${String(control)}99`
      : (mixColor(base, String(control), PLAIN_BUBBLE_SHARE) ?? String(control));
  // A sample agent color: the violet preset of the desktop picker.
  const solid = pageColor ?? (mode === "custom" ? customColor : "#b474f4");
  const bubble =
    mode === "none" && !pageColor ? plain : style === "tint" ? tintedMessageColor(solid, String(surface), dark) : solid;
  return (
    <View
      className="mx-4 my-3 overflow-hidden rounded-3xl border border-border bg-background"
      style={{ height: PREVIEW_HEIGHT, borderCurve: "continuous" }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <ChatBackdropLayer variant="preview" active={active} />
      <View className="flex-1 justify-end gap-2 p-4">
        <View className="max-w-[80%] self-end rounded-2xl px-3 py-2" style={{ backgroundColor: bubble }}>
          <Typography type="body-sm" style={{ color: readableOn(bubble) }}>
            {t("mobile.settings.appearance.backdrop.previewQuestion")}
          </Typography>
        </View>
        <View className="max-w-[85%] self-start rounded-2xl px-3 py-2" style={{ backgroundColor: plain }}>
          <Typography type="body-sm" className="text-foreground">
            {t("mobile.settings.appearance.backdrop.previewAnswer")}
          </Typography>
        </View>
      </View>
    </View>
  );
}

/**
 * Settings › Appearance › Backdrop: the scene behind Home and the chats on this phone, as the desktop
 * window backdrop. It shows a preview, the choices and how strong the scene is.
 */
export function ChatBackdropSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const focused = useIsFocused();
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
    // An agent page needs the web view; an old Android build without it does not offer the page.
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
      // The chosen photo opens the library again, so the reader can change it.
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
        <BackdropPreview active={focused} />
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
            // The preview and the chats follow the finger; the value is saved when it lifts.
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
            // Bubbles are solid with no backdrop, so the switch waits until a backdrop shows.
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
