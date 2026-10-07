import { Host, TextInput } from "@expo/ui";
import { useNativeState } from "@expo/ui/swift-ui";
import { accessibilityLabel } from "@expo/ui/swift-ui/modifiers";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect } from "react";
import { View } from "react-native";

import type { SheetFormFieldProps } from "@/shared/components/sheet-form-field.types";

export function SheetFormField({
  autoCapitalize,
  autoCorrect,
  autoFocus,
  editable,
  hint,
  trailing,
  inputMode,
  isRequired = false,
  label,
  maxLength,
  multiline = false,
  appearance = "default",
  hideLabel = false,
  textAlign,
  onChangeText,
  onSubmitEditing,
  placeholder,
  returnKeyType,
  value,
}: SheetFormFieldProps) {
  const [foreground, muted, border] = useThemeColor(["foreground", "muted", "border"]);
  const nativeValue = useNativeState(value);
  useEffect(() => {
    nativeValue.set(value);
  }, [nativeValue, value]);
  const height = multiline ? 108 : 54;

  return (
    <View className="gap-2">
      {!hideLabel && (
        <Typography type="body-xs" className="px-4 text-grouped-secondary">
          {label}
          {isRequired ? " *" : ""}
        </Typography>
      )}
      <View
        className="bg-grouped"
        style={{
          borderColor: border,
          borderCurve: "continuous",
          borderRadius: 16,
          borderWidth: appearance === "soft" ? 0 : 1,
          height,
          overflow: "hidden",
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Host ignoreSafeArea="all" style={{ height, flex: 1 }}>
          <TextInput
            modifiers={[accessibilityLabel(label)]}
            multiline={multiline}
            numberOfLines={multiline ? 4 : 1}
            textAlign={textAlign}
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCorrect}
            autoFocus={autoFocus}
            editable={editable}
            inputMode={inputMode}
            maxLength={maxLength}
            placeholder={placeholder}
            placeholderTextColor={muted}
            returnKeyType={returnKeyType}
            selectionColor={foreground}
            style={{ height, paddingHorizontal: 16 }}
            textStyle={{ color: String(foreground), fontSize: 16 }}
            value={nativeValue}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmitEditing}
          />
        </Host>
        {trailing}
      </View>
      {hint ? (
        <View className="px-1">
          <Typography.Paragraph type="body-xs" className="text-text-secondary">
            {hint}
          </Typography.Paragraph>
        </View>
      ) : null}
    </View>
  );
}
