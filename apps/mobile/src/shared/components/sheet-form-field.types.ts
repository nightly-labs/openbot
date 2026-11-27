import type { ReactNode } from "react";
import type { TextInputProps } from "react-native";

export interface SheetFormFieldProps {
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoCorrect?: boolean;
  autoFocus?: boolean;
  editable?: boolean;
  hint?: string;
  error?: string;
  trailing?: ReactNode;
  inputMode?: TextInputProps["inputMode"];
  isRequired?: boolean;
  label: string;
  maxLength?: number;
  multiline?: boolean;
  tall?: boolean;
  appearance?: "default" | "soft";
  hideLabel?: boolean;
  textAlign?: "left" | "center" | "right";
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  placeholder?: string;
  returnKeyType?: TextInputProps["returnKeyType"];
  secureTextEntry?: boolean;
  value: string;
}
