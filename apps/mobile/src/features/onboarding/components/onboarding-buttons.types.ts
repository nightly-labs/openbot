import type { LucideIcon } from "lucide-react-native";

interface GlassTiming {
  /** iOS: when the glass may form, after the fade of its step (see `glassAfter`). */
  appearDelay?: number;
}

/** The main action of a step. It fills the width it gets. */
export interface OnboardingPrimaryButtonProps extends GlassTiming {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** The colour of the agent. Without one, the button uses the action colour of the theme. */
  color?: string;
}

/** A round button with an icon only. */
export interface OnboardingIconButtonProps extends GlassTiming {
  /** An arrow that points in the reading direction. It turns in a right-to-left layout. */
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size: number;
}

/** A short, one-line action or choice in a capsule. The chosen one takes the agent's colour. */
export interface OnboardingPillButtonProps extends GlassTiming {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  selected?: boolean;
  /** The colour of a chosen pill. */
  color?: string;
  /** 44 pt for choices in a step, 52 pt beside the main action. */
  size?: "regular" | "large";
}
