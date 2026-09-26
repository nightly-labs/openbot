import { useThemeColor } from "heroui-native/hooks";
import { TextInput } from "react-native";

import type { MobileSearchTextInputProps } from "@/features/search/components/search-text-input.types";
import { useText } from "@/shared/lib/text";

export function MobileSearchTextInput({ value, onChangeText }: MobileSearchTextInputProps) {
  const { t } = useText();
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);

  return (
    <TextInput
      accessibilityLabel={t("common.search")}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus
      className="h-8 min-w-0 flex-1 font-sans text-foreground"
      placeholder={t("common.search")}
      placeholderTextColor={muted}
      returnKeyType="search"
      selectionColor={foreground}
      style={{ fontSize: 16, lineHeight: 20, paddingBottom: 0, paddingTop: 0, textAlignVertical: "center" }}
      value={value}
      onChangeText={onChangeText}
    />
  );
}
