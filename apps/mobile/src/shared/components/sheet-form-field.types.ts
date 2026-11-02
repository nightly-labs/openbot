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
  isRequired?: boolean;
  label: string;
  maxLength?: number;
  multiline?: boolean;
  appearance?: "default" | "soft";
  hideLabel?: boolean;
  /** React Native 0.88 adds `start` and `end`, which the iOS field does not take. */
  textAlign?: "left" | "center" | "right";
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  placeholder?: string;
  returnKeyType?: TextInputProps["returnKeyType"];
  /** Hides the text, for a key or a password. */
  secureTextEntry?: boolean;
  value: string;
}
