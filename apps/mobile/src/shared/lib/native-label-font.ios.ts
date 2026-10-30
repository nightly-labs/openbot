import { font } from "@expo/ui/swift-ui/modifiers";
import { APP_FONT } from "@/shared/lib/app-font";

/** Puts the app font on the label of an `@expo/ui` control at the body size, with Dynamic Type. */
export const nativeLabelFont = [font({ family: APP_FONT, textStyle: "body" })];
