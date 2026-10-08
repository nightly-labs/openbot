import { Link } from "expo-router";
import type { PropsWithChildren } from "react";
import { useMotionPreference } from "@/shared/lib/motion";

/**
 * The avatar that a chat zooms out of and back into on iOS. When Settings turns the zoom off, or
 * motion is reduced, the Link has no zoom source and the chat opens with the normal slide.
 */
export function ChatZoomSource({ children }: PropsWithChildren) {
  const zoom = useMotionPreference("chatZoom");
  return zoom ? <Link.AppleZoom>{children}</Link.AppleZoom> : children;
}
