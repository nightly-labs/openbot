import type { ReactNode } from "react";
import type { TextInputProps } from "react-native";

export interface SheetFormFieldProps {
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoCorrect?: boolean;
  autoFocus?: boolean;
  editable?: boolean;
  hint?: string;
  trailing?: ReactNode;
  inputMode?: TextInputProps["inputMode"];
  keyboardType?: TextInputProps["keyboardType"];
  isRequired?: boolean;
  label: string;
  maxLength?: number;
  multiline?: boolean;
  appearance?: "default" | "soft";
  hideLabel?: boolean;
  textAlign?: TextInputProps["textAlign"];
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  placeholder?: string;
  returnKeyType?: TextInputProps["returnKeyType"];
  secureTextEntry?: TextInputProps["secureTextEntry"];
  value: string;
}
