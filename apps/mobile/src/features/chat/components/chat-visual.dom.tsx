"use dom";

import {
  type ChatVisualAppearance,
  chatVisualAppTheme,
  chatVisualDocument,
  parseChatVisualMessage,
} from "@openbot/contracts/chat-visual";
import { useEffect, useMemo, useRef } from "react";

interface ChatVisualPageProps {
  /** The page bytes as base64, which a prop can carry without escapes. */
  base64: string;
  title: string;
  appearance: ChatVisualAppearance;
  background: string;
  onHeight?: (height: number) => Promise<void>;
  onOpenLink?: (url: string) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}

function decodePage(base64: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
  } catch {
    return "";
  }
}

/**
 * A visual reply page, as on desktop: a frame with scripts but not `allow-same-origin`, so the page
 * has an opaque origin. It cannot reach this web view, which can call back into the app. The page
 * can only post messages, and each one is checked. A link opens only after a tap of the user.
 */
export default function ChatVisualPage({
  // Empty in Expo Go on Android until the props come again; see expo-go-dom.ts.
  base64 = "",
  title = "",
  appearance = "dark",
  background,
  onHeight,
  onOpenLink,
}: ChatVisualPageProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const page = useMemo(() => {
    const html = decodePage(base64);
    // The chat shows through the transparent canvas of the page.
    const theme = { ...chatVisualAppTheme(appearance), "--background": "transparent" };
    return html ? chatVisualDocument(html, { theme, appearance }) : "";
  }, [base64, appearance]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target) return;
      const message = parseChatVisualMessage(event.data);
      if (!message) return;
      if (message.type === "size") {
        void onHeight?.(message.height);
        return;
      }
      target.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
      // This web view holds only the page, so an activation here is a tap in the page.
      if (navigator.userActivation?.isActive === true) void onOpenLink?.(message.url);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onHeight, onOpenLink]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", background }}>
      {page ? (
        <iframe
          ref={frame}
          title={title}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          srcDoc={page}
          style={{ flex: 1, width: "100%", height: "100%", border: 0, colorScheme: appearance }}
        />
      ) : null}
    </div>
  );
}
