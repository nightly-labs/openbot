import type { LucideIcon } from "lucide-react-native";

interface GlassTiming {
  appearDelay?: number;
}

export interface OnboardingPrimaryButtonProps extends GlassTiming {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}

export interface OnboardingIconButtonProps extends GlassTiming {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size: number;
}

export interface OnboardingPillButtonProps extends GlassTiming {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  selected?: boolean;
  color?: string;
  size?: "regular" | "large";
}
