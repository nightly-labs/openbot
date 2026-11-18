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
  // The SwiftUI field is not a React Native `Text`, so it takes the text size of the app here.
  const textScale = useTextScale();
  const nativeValue = useNativeState(value);
  // On iOS 18 and later, SwiftUI stops the app ("String index is out of bounds") when JS replaces the
  // text of a focused field: the selection still points into the old text (expo/expo#47434, #48274).
  // When the user types fast, a re-render can send an older value back. So the field keeps its text
  // while it has focus, and a different value from JS goes to the field at blur. Clearing is safe at
  // once: the field drops each selection that is past the end of the new text.
  const focused = useRef(false);
  const fieldText = useRef(value);
  const latestValue = useRef(value);
  latestValue.current = value;
  useEffect(() => {
    if ((focused.current && value !== "") || value === fieldText.current) return;
    fieldText.current = value;
    nativeValue.set(value);
  }, [nativeValue, value]);
  const lines = multiline ? (tall ? 14 : 4) : 1;
  // A tall field takes the height of its lines, so the lines fill it.
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
            // SwiftUI aligns to the leading or trailing side of the layout. Text in the other
            // direction than the layout goes to the trailing side.
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
              fieldText.current = text;
              onChangeText(text);
            }}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
              if (latestValue.current === fieldText.current) return;
              fieldText.current = latestValue.current;
              nativeValue.set(latestValue.current);
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
