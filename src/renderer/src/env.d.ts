/// <reference types="vite/client" />

import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

declare global {
  interface HighlightRegistry {
    set(name: string, highlight: Highlight): this;
    delete(name: string): boolean;
  }

  interface Window {
    openbot: OpenBotDesktopApi;
  }

  interface ExtensionSignInMessage {
    kind: string;
    state: string;
    code?: string;
    error?: string;
  }

  interface ExtensionMessaging {
    sendMessage?(extensionId: string, message: ExtensionSignInMessage): Promise<{ received?: boolean } | undefined>;
  }

  var chrome: { runtime?: ExtensionMessaging } | undefined;
}
