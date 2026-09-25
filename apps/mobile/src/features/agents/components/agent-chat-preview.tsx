import { Link } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

const HEADER_HEIGHT = 64;
const SIDE_INSET = 16;
const BUBBLE_MARGIN = 12;
/** The host keeps only this many characters of the latest message (`AgentStore.updatePreview`). */
const HOST_PREVIEW_LIMIT = 180;
const FALLBACK_LINE_HEIGHT = 27;
const FALLBACK_CHARACTER_WIDTH = 7;

/** Ends a preview that the host cut at its limit on a whole word, so it does not stop inside one. */
function previewText(preview: string): string {
  const text = preview.trim();
  if (preview.length < HOST_PREVIEW_LIMIT) return text;
  const lastSpace = text.search(/\s\S*$/);
  return `${(lastSpace > 0 ? text.slice(0, lastSpace) : text).replace(/[\s.,;:!?—–-]+$/, "")}…`;
}

function PreviewBubble({ text, onHeight }: { text: string; onHeight?: (height: number) => void }) {
  const { agents } = useMobileWorkspace();
  const foreground = useThemeColor("foreground");
  return (
    <View
      className="max-w-full self-start rounded-[30px] bg-control/60 px-4 py-3"
      style={{ borderCurve: "circular" }}
      onLayout={onHeight ? (event) => onHeight(event.nativeEvent.layout.height) : undefined}
    >
      <ChatMarkdown agents={agents} body={text} color={foreground} selectable={false} animationEnabled={false} />
    </View>
  );
}

/**
 * The long-press preview of an agent chat: who it is and the latest message, as iOS Messages shows it.
 *
 * `preview` is the `Link.Preview` element itself: `Link` finds its preview by element type, so a
 * wrapper component would be ignored. The native preview reads its size once, when it opens, and
 * renders its content only after that. So `measurer` lays out an invisible copy of the bubble in the
 * row when a touch starts (`onPressIn`), before the long press opens the preview.
 */
export function useAgentChatPreview(agent: MobileAgent) {
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const [measuring, setMeasuring] = useState(false);
  const [bubbleHeight, setBubbleHeight] = useState<number | null>(null);
  const width = screenWidth - 2 * SIDE_INSET;
  const bubbleWidth = width - 2 * SIDE_INSET;
  const text = previewText(agent.preview);

  const fallbackLines = Math.ceil((text.length * FALLBACK_CHARACTER_WIDTH * fontScale) / (bubbleWidth - 32));
  const estimatedBubbleHeight = bubbleHeight ?? 24 + Math.max(1, fallbackLines) * FALLBACK_LINE_HEIGHT * fontScale;
  const height = HEADER_HEIGHT + 1 + (text ? estimatedBubbleHeight + 2 * BUBBLE_MARGIN : 0);

  const preview = (
    <Link.Preview style={{ width, height }}>
      <View className="flex-1 bg-background">
        <View className="flex-row items-center gap-3 px-4" style={{ height: HEADER_HEIGHT }}>
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
            seed={agent.avatarSeed}
            size={36}
            animateIdle={false}
          />
          <Typography.Paragraph className="min-w-0 flex-1" weight="semibold" numberOfLines={1}>
            {agent.name}
          </Typography.Paragraph>
        </View>
        <View className="h-px bg-separator" />
        {text ? (
          <View
            className="min-h-0 flex-1 overflow-hidden"
            style={{ padding: BUBBLE_MARGIN, paddingHorizontal: SIDE_INSET }}
          >
            <PreviewBubble text={text} />
          </View>
        ) : null}
      </View>
    </Link.Preview>
  );

  const measurer =
    measuring && text ? (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", left: 0, top: 0, width: bubbleWidth, opacity: 0 }}
      >
        <PreviewBubble text={text} onHeight={setBubbleHeight} />
      </View>
    ) : null;

  return { preview, measurer, onPressIn: () => setMeasuring(true) };
}
