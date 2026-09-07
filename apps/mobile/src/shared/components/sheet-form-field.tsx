import { Input, TextArea, TextField, Typography } from "heroui-native";
import { View } from "react-native";

import type { SheetFormFieldProps } from "@/shared/components/sheet-form-field.types";

export function SheetFormField({
  hint,
  isRequired = false,
  label,
  multiline = false,
  appearance = "default",
  hideLabel = false,
  ...inputProps
}: SheetFormFieldProps) {
  const Control = multiline ? TextArea : Input;
  return (
    <TextField isRequired={isRequired}>
      {!hideLabel && (
        <Typography type="body-sm" weight="semibold">
          {label}
        </Typography>
      )}
      <Control
        accessibilityLabel={label}
        className={`rounded-2xl px-4 font-sans text-body ${multiline ? "min-h-28" : "min-h-12"} ${appearance === "soft" ? "border-0 bg-surface shadow-none" : ""}`}
        multiline={multiline}
        variant="primary"
        {...inputProps}
      />
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
