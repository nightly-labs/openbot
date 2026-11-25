import { Platform, StyleSheet, type TextStyle } from "react-native";
import { APP_FONT } from "@/shared/lib/app-font";

export type ChatTextType = "body" | "body-sm" | "h4" | "h5";

export const CHAT_TEXT_STYLES = StyleSheet.create({
  body: { fontFamily: APP_FONT, fontWeight: "400", fontSize: 16, lineHeight: 22 },
  "body-sm": { fontFamily: APP_FONT, fontWeight: "400", fontSize: 14, lineHeight: 20 },
  h4: { fontFamily: APP_FONT, fontWeight: "600", fontSize: 20, lineHeight: 26, letterSpacing: -0.5 },
  h5: { fontFamily: APP_FONT, fontWeight: "600", fontSize: 18, lineHeight: 24, letterSpacing: -0.45 },
}) satisfies Record<ChatTextType, TextStyle>;

export const CHAT_HEADING_RAMP = { h4: "title3", h5: "headline" } as const;

const CODE_FONT = Platform.OS === "ios" ? "Menlo" : "monospace";

export const CHAT_CODE_STYLES = StyleSheet.create({
  body: { fontFamily: CODE_FONT, fontSize: 14, lineHeight: 20 },
  small: { fontFamily: CODE_FONT, fontSize: 12, lineHeight: 16 },
});
