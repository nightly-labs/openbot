import { Input, TextArea, TextField, Typography } from "heroui-native";
import { View } from "react-native";

import type { SheetFormFieldProps } from "@/shared/components/sheet-form-field.types";

export function SheetFormField({
  hint,
  error,
  trailing,
  isRequired = false,
  label,
  multiline = false,
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
            className={`rounded-2xl bg-grouped px-4 font-sans text-body ${multiline ? "min-h-28" : "min-h-12"} ${trailing ? "border-0 bg-transparent shadow-none" : error ? "border border-danger shadow-none" : appearance === "soft" ? "border-0 shadow-none" : ""}`}
            multiline={multiline}
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
