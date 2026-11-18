import { useIsFocused } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Bookmark from "lucide-react-native/icons/bookmark";
import Brain from "lucide-react-native/icons/brain";
import Repeat from "lucide-react-native/icons/repeat";
import type { ComponentType } from "react";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { ChatBackdropLayer, useChatBackdropBase } from "@/features/chat/components/chat-backdrop-layer";
import { readableOn } from "@/features/onboarding/model/onboarding-colors";
import { useChatBackdrop } from "@/features/settings/model/chat-backdrop";
import { useChatBackgroundColor } from "@/features/settings/model/chat-background";
import {
  useMemoryChangesDisplayPreference,
  useThinkingDisplayPreference,
} from "@/features/settings/model/chat-details";
import {
  mixColor,
  PLAIN_BUBBLE_SHARE,
  tintedMessageColor,
  useMessageColor,
} from "@/features/settings/model/message-color";
import { useRoutineCollapsePreference } from "@/features/settings/model/routine-collapse";
import { useText } from "@/shared/lib/text";

/** The height of the preview: the detail rows, a question and the start of a reply. */
const PREVIEW_HEIGHT = 230;
/** A sample agent color: the violet preset of the desktop picker. */
const SAMPLE_AGENT_COLOR = "#b474f4";

/** A muted detail row of a chat, such as the agent's thinking. */
function DetailRow({
  icon: Icon,
  label,
  color,
}: {
  icon: ComponentType<{ size: number; color: string }>;
  label: string;
  color: string;
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon size={13} color={color} />
      <Typography type="body-xs" className="text-muted">
        {label}
      </Typography>
    </View>
  );
}

/**
 * A short chat as the chats draw it, at the top of Settings › Appearance: the backdrop or the chat
 * background, the reader's bubble, an agent reply and the detail rows that are on. Text size, theme,
 * colors, backdrop and chat details change it at once, so each tab shows its effect. It has no
 * meaning of its own for a screen reader.
 */
export function AppearancePreview() {
  const { t } = useText();
  const focused = useIsFocused();
  const dark = useUniwind().theme === "dark";
  const mode = useMessageColor((state) => state.mode);
  const customColor = useMessageColor((state) => state.customColor);
  const style = useMessageColor((state) => state.style);
  const seeThrough = useMessageColor((state) => state.seeThrough);
  const pageColor = useChatBackdrop((state) =>
    state.choice === "agent" ? state.agentPage?.bubbles?.yours : undefined,
  );
  const routines = useRoutineCollapsePreference((state) => state.enabled);
  const thinking = useThinkingDisplayPreference((state) => state.enabled);
  const memories = useMemoryChangesDisplayPreference((state) => state.enabled);
  const [surfaceColor, controlColor, mutedColor] = useCSSVariable([
    "--openbot-bg-surface",
    "--openbot-bg-control",
    "--openbot-text-muted",
  ]);
  const surface = String(surfaceColor);
  const control = String(controlColor);
  const muted = String(mutedColor);
  const background = String(useThemeColor("background"));
  const backdropBase = useChatBackdropBase();
  const chatBackground = useChatBackgroundColor();
  const base = backdropBase ?? chatBackground ?? background;
  // A bubble with no color and an agent bubble, as the chat draws them: solid on the chat surface, or
  // see-through over a backdrop.
  const plain =
    seeThrough && backdropBase !== null ? `${control}99` : (mixColor(base, control, PLAIN_BUBBLE_SHARE) ?? control);
  const solid = pageColor ?? (mode === "custom" ? customColor : SAMPLE_AGENT_COLOR);
  const bubble =
    // As the chat: with no message color, the color of an agent page does not apply either.
    mode === "none" ? plain : style === "tint" ? tintedMessageColor(solid, surface, dark) : solid;
  return (
    <View
      className="overflow-hidden rounded-3xl border border-border"
      style={{ height: PREVIEW_HEIGHT, borderCurve: "continuous", backgroundColor: base }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <ChatBackdropLayer variant="preview" active={focused} />
      <View className="flex-1 justify-end gap-2 p-4">
        {routines ? (
          <DetailRow icon={Repeat} label={t("mobile.settings.appearance.preview.routines")} color={muted} />
        ) : null}
        <View className="max-w-[80%] self-end rounded-2xl px-3 py-2" style={{ backgroundColor: bubble }}>
          <Typography type="body-sm" style={{ color: readableOn(bubble) }}>
            {t("mobile.settings.appearance.backdrop.previewQuestion")}
          </Typography>
        </View>
        {thinking ? (
          <DetailRow icon={Brain} label={t("mobile.settings.appearance.preview.thinking")} color={muted} />
        ) : null}
        <View className="max-w-[85%] self-start rounded-2xl px-3 py-2" style={{ backgroundColor: plain }}>
          <Typography type="body-sm" className="text-foreground">
            {t("mobile.settings.appearance.backdrop.previewAnswer")}
          </Typography>
        </View>
        {memories ? (
          <DetailRow icon={Bookmark} label={t("mobile.settings.appearance.preview.memory")} color={muted} />
        ) : null}
      </View>
    </View>
  );
}
