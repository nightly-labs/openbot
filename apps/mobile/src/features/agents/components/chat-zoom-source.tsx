import { Link } from "expo-router";
import type { PropsWithChildren } from "react";
import { useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import { useMotionPreference } from "@/shared/lib/motion";

/**
 * The avatar that a chat zooms out of and back into on iOS. When Settings turns the zoom off, or
 * motion is reduced, the Link has no zoom source and the chat opens with the normal slide. A row in
 * the chat list pane stays in view beside the chat it opens, so it has no zoom source either.
 */
export function ChatZoomSource({ children }: PropsWithChildren) {
  const inPane = useChatListPane() !== null;
  const zoom = useMotionPreference("chatZoom") && !inPane;
  return zoom ? <Link.AppleZoom>{children}</Link.AppleZoom> : children;
}
