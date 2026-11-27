import { type NativeModule, requireOptionalNativeModule } from "expo";
import { expoGoOnAndroid } from "@/shared/lib/expo-go";
import type { ChatBubbleNative, ChatBubbleTarget } from "./chat-bubble-native.types";

declare class ChatBubbleModule extends NativeModule {
  isSupported(): boolean;
  areBubblesEnabled(): boolean;
  openBubbleSettings(): void;
  currentTarget(): ChatBubbleTarget | null;
  dismiss(serverId: string, agentId: string): void;
  close(): void;
}

function load(): ChatBubbleNative | null {
  if (expoGoOnAndroid()) return null;
  const native = requireOptionalNativeModule<ChatBubbleModule>("OpenBotChatBubble");
  if (!native) return null;
  return {
    isSupported: () => native.isSupported(),
    areBubblesEnabled: () => native.areBubblesEnabled(),
    openBubbleSettings: () => native.openBubbleSettings(),
    currentTarget: () => native.currentTarget() ?? null,
    dismiss: (serverId, agentId) => native.dismiss(serverId, agentId),
    close: () => native.close(),
  };
}

export const chatBubbleNative: ChatBubbleNative | null = load();
