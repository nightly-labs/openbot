import type { ComponentType } from "react";
import { TurboModuleRegistry } from "react-native";

export interface HtmlPageProps {
  source: string;
  title: string;
  /**
   * `screen` fills the preview screen, scrolls, and opens a tapped web link in the browser. `chat`
   * is part of a reply: the caller makes it take no touches.
   */
  mode: "screen" | "chat";
  /** The space that the floating header and the home indicator cover on the preview screen. */
  insets?: { top: number; bottom: number };
}

/**
 * An HTML file or a visual reply as a live page with its scripts, as desktop shows it. It needs
 * the native module of react-native-webview, which throws when it loads without it. An Android
 * build from before Android linked it has none: there this is null, and the caller shows the page
 * with no scripts.
 */
const pageView: typeof import("./html-page-view.native") | null = TurboModuleRegistry.get("RNCWebViewModule")
  ? require("./html-page-view.native")
  : null;
export const HtmlPage: ComponentType<HtmlPageProps> | null = pageView ? pageView.HtmlPageView : null;
