import { chatVisualFrameHeight, isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import * as Linking from "expo-linking";
import { useThemeColor } from "heroui-native/hooks";
import { memo, useCallback, useState } from "react";
import { View } from "react-native";
import { useUniwind } from "uniwind";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import type { ChatMessage } from "../model/chat-messages";
import { useAttachmentFile } from "./attachment-preview";
import { ChatAttachmentView } from "./chat-attachment";
import ChatVisualPage from "./chat-visual.dom";

type VisualMessage = Extract<ChatMessage, { kind: "visual" }>;

function webLink(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A visual reply: an agent's HTML page above its reply, at the full width of the chat. While the
 * page downloads, the row keeps the agent's height. A page that this phone cannot get shows as its
 * file, which the user can share.
 */
export const ChatVisualRow = memo(function ChatVisualRow({
  message,
  serverId,
}: {
  message: VisualMessage;
  serverId: string;
}) {
  const { theme } = useUniwind();
  const background = useThemeColor("background");
  const tooLarge = message.attachment.size > MOBILE_ATTACHMENT_BYTES;
  const { query } = useAttachmentFile(serverId, message.attachment, !tooLarge);
  const [reported, setReported] = useState<number>();
  const onHeight = useCallback(async (height: number) => setReported(height), []);
  const onOpenLink = useCallback(async (href: string) => {
    const url = webLink(href);
    if (url) await Linking.openURL(url);
  }, []);
  const data = query.data;
  if (tooLarge || query.error || (data && !isChatVisualMimeType(data.mimeType)))
    return <ChatAttachmentView attachment={message.attachment} serverId={serverId} />;
  return (
    <View className="w-full" style={{ height: chatVisualFrameHeight(reported, message.height) }}>
      {data ? (
        <ChatVisualPage
          base64={data.base64}
          title={message.title}
          appearance={theme === "light" ? "light" : "dark"}
          background={String(background)}
          onHeight={onHeight}
          onOpenLink={onOpenLink}
          dom={{
            ...expoGoDomOptions,
            style: { flex: 1, backgroundColor: "transparent" },
            containerStyle: { flex: 1 },
            scrollEnabled: false,
          }}
        />
      ) : null}
    </View>
  );
});
