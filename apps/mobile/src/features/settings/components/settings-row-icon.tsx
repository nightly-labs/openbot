import type { LucideIcon } from "lucide-react-native";
import { useCSSVariable } from "uniwind";

/**
 * The icon before the title of a settings row. Where the desktop settings have a tab for the same
 * item, the row uses its icon. An action row with accent text has an accent icon, and a destructive
 * row a danger icon.
 */
const TONE_COLORS = {
  muted: "--openbot-text-grouped-secondary",
  accent: "--openbot-accent",
  danger: "--openbot-danger-text",
} as const;

export function RowIcon({ icon: Icon, tone = "muted" }: { icon: LucideIcon; tone?: keyof typeof TONE_COLORS }) {
  const color = String(useCSSVariable(TONE_COLORS[tone]));
  return <Icon size={20} color={color} strokeWidth={1.75} />;
}
