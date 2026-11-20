import type { AvatarColor } from "@openbot/contracts/ipc";

export interface MessageColorPickerProps {
  value: AvatarColor;
  disabled: boolean;
  dark: boolean;
  onChange: (value: AvatarColor) => void;
}
