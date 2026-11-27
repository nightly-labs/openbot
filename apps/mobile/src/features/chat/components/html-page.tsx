import type { ComponentType } from "react";
import { TurboModuleRegistry } from "react-native";

export interface HtmlPageProps {
  source: string;
  title: string;
  mode: "screen" | "chat";
  scripts?: boolean;
  onHeight?: (height: number) => void;
  insets?: { top: number; bottom: number };
}

const pageView: typeof import("./html-page-view.native") | null = TurboModuleRegistry.get("RNCWebViewModule")
  ? require("./html-page-view.native")
  : null;
export const HtmlPage: ComponentType<HtmlPageProps> | null = pageView ? pageView.HtmlPageView : null;
