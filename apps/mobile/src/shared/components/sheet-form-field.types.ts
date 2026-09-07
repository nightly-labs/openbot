import type { TextInputProps } from "react-native";

export interface SheetFormFieldProps {
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoCorrect?: boolean;
  autoFocus?: boolean;
  editable?: boolean;
  hint?: string;
  inputMode?: TextInputProps["inputMode"];
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
  value: string;
}
