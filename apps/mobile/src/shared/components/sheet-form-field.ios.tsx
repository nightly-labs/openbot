import { Host, TextInput } from "@expo/ui";
import { useNativeState } from "@expo/ui/swift-ui";
import { accessibilityLabel } from "@expo/ui/swift-ui/modifiers";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useRef } from "react";
import { View } from "react-native";

import { useTextScale } from "@/features/settings/model/text-size-store";
import type { SheetFormFieldProps } from "@/shared/components/sheet-form-field.types";
import { APP_FONT } from "@/shared/lib/app-font";
import { layoutDirection, textDirection } from "@/shared/lib/text-direction";

const RECENT_FIELD_TEXTS = 8;

export function SheetFormField({
  autoCapitalize,
  autoCorrect,
  autoFocus,
  editable,
  hint,
  error,
  trailing,
  inputMode,
  isRequired = false,
  label,
  maxLength,
  multiline = false,
  tall = false,
  appearance = "default",
  hideLabel = false,
  textAlign,
  onChangeText,
  onSubmitEditing,
  placeholder,
  returnKeyType,
  secureTextEntry,
  value,
}: SheetFormFieldProps) {
  const [foreground, muted, border, danger] = useThemeColor(["foreground", "muted", "border", "danger"]);
  const textScale = useTextScale();
  const nativeValue = useNativeState(value);
  const fieldTexts = useRef([value]);
  useEffect(() => {
    const [current, ...older] = fieldTexts.current;
    if (value === current || (value !== "" && older.includes(value))) return;
    fieldTexts.current = [value];
    nativeValue.set(value);
  }, [nativeValue, value]);
  const lines = multiline ? (tall ? 14 : 4) : 1;
  const height = tall && multiline ? undefined : multiline ? 108 : 54;

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
          borderColor: error ? danger : border,
          borderCurve: "continuous",
          borderRadius: 16,
          borderWidth: appearance === "soft" && !error ? 0 : 1,
          height,
          overflow: "hidden",
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Host
          ignoreSafeArea="all"
          matchContents={height === undefined ? { vertical: true } : undefined}
          style={{ height, flex: 1 }}
        >
          <TextInput
            modifiers={[accessibilityLabel(label)]}
            multiline={multiline}
            numberOfLines={lines}
            textAlign={textAlign ?? (textDirection(value, layoutDirection()) === layoutDirection() ? "left" : "right")}
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCorrect}
            autoFocus={autoFocus}
            editable={editable}
            inputMode={inputMode}
            maxLength={maxLength}
            placeholder={placeholder}
            placeholderTextColor={muted}
            returnKeyType={returnKeyType}
            secureTextEntry={secureTextEntry}
            selectionColor={foreground}
            style={
              height === undefined ? { paddingHorizontal: 16, paddingVertical: 12 } : { height, paddingHorizontal: 16 }
            }
            textStyle={{ color: String(foreground), fontFamily: APP_FONT, fontSize: 16 * textScale }}
            value={nativeValue}
            onChangeText={(text) => {
              fieldTexts.current = [text, ...fieldTexts.current.slice(0, RECENT_FIELD_TEXTS - 1)];
              onChangeText(text);
            }}
            onSubmitEditing={onSubmitEditing}
          />
        </Host>
        {trailing}
      </View>
      {error ? (
        <View className="px-4">
          <Typography.Paragraph type="body-xs" accessibilityRole="alert" className="text-danger-text">
            {error}
          </Typography.Paragraph>
        </View>
      ) : null}
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
