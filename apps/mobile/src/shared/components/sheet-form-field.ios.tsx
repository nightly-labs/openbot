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

// Fast typing can be some keystrokes in front of JS. This many recent field texts count as echoes.
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
  // The SwiftUI field is not a React Native `Text`, so it takes the text size of the app here.
  const textScale = useTextScale();
  const nativeValue = useNativeState(value);
  // On iOS 18 and later, SwiftUI stops the app ("String index is out of bounds") when JS replaces the
  // text of a focused field: the selection still points into the old text (expo/expo#47434, #48274).
  // When the user types fast, a re-render can send back an older text that the field sent. Such an
  // echo is not written to the field. Other values from JS, such as a paste, go at once. A clear goes
  // at once too: it is safe, because the field drops each selection past the end of the new text.
  const fieldTexts = useRef([value]);
  useEffect(() => {
    const [current, ...older] = fieldTexts.current;
    if (value === current || (value !== "" && older.includes(value))) return;
    fieldTexts.current = [value];
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
