import { Input, TextArea, TextField, Typography } from "heroui-native";
import { View } from "react-native";

import type { SheetFormFieldProps } from "@/shared/components/sheet-form-field.types";

// The heroui-native `TextArea` class sets a fixed height, and a utility class does not replace it on
// native. The style prop comes after the classes. The iOS field uses the same height.
const tallStyle = { height: 280 } as const;
// A field inside a frame of its own (a trailing button, or a card): HeroUI raises the field and draws
// a focus border on Android, which show as a darker box and an accent ring inside the frame.
const FRAMELESS =
  "android:[elevation:0] android:border-0 android:focus:border-transparent ios:outline-transparent ios:focus:outline-transparent";

export function SheetFormField({
  hint,
  error,
  trailing,
  isRequired = false,
  label,
  multiline = false,
  tall = false,
  appearance = "default",
  hideLabel = false,
  ...inputProps
}: SheetFormFieldProps) {
  const Control = multiline ? TextArea : Input;
  return (
    <TextField isRequired={isRequired} isInvalid={Boolean(error)}>
      {!hideLabel && (
        <Typography type="body-xs" className="px-4 text-grouped-secondary">
          {label}
          {isRequired ? " *" : ""}
        </Typography>
      )}
      <View
        className={
          trailing
            ? `flex-row items-center rounded-2xl bg-grouped ${error ? "border border-danger" : appearance === "soft" ? "" : "border border-border"}`
            : "flex-row items-center"
        }
      >
        <View className="min-w-0 flex-1">
          <Control
            accessibilityLabel={label}
            className={`rounded-2xl bg-grouped px-4 font-sans text-body ${multiline ? "min-h-28" : "min-h-12"} ${trailing ? `border-0 bg-transparent shadow-none ${FRAMELESS}` : error ? "border border-danger shadow-none" : appearance === "soft" ? `border-0 shadow-none ${FRAMELESS}` : ""}`}
            multiline={multiline}
            style={multiline && tall ? tallStyle : undefined}
            variant="primary"
            {...inputProps}
          />
        </View>
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
    </TextField>
  );
}
