import type { ModifierConfig } from "@expo/ui/jetpack-compose/modifiers";

const NO_MODIFIERS: ModifierConfig[] = [];

/** Compose has no font modifier, so an Android `@expo/ui` label keeps the system font. */
export function useNativeLabelFont(): ModifierConfig[] {
  return NO_MODIFIERS;
}
