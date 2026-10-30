import type { ModifierConfig } from "@expo/ui/jetpack-compose/modifiers";

/** Compose has no font modifier, so an Android `@expo/ui` label keeps the system font. */
export const nativeLabelFont: ModifierConfig[] = [];
