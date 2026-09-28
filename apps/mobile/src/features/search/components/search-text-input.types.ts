import type { Ref } from "react";

export interface MobileSearchTextInputHandle {
  focus: () => void;
}

export interface MobileSearchTextInputProps {
  ref?: Ref<MobileSearchTextInputHandle>;
  value: string;
  onChangeText: (value: string) => void;
}
