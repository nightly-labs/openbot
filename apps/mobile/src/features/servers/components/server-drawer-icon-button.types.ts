import type { PropsWithChildren } from "react";
import type { ColorValue } from "react-native";

export interface ServerDrawerIconButtonProps extends PropsWithChildren {
  accessibilityLabel: string;
  color: ColorValue;
  systemName: "checkmark" | "gearshape" | "plus";
  onPress: () => void;
}
