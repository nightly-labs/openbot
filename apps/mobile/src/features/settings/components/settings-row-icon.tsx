import type { LucideIcon } from "lucide-react-native";
import { useCSSVariable } from "uniwind";

/**
 * The icon before the title of a settings row. Where the desktop settings have a tab for the same
 * item, the row uses its icon. An action row with accent text has an accent icon, and a destructive
 * row a danger icon.
 */
export function RowIcon({ icon: Icon, tone = "muted" }: { icon: LucideIcon; tone?: "muted" | "accent" | "danger" }) {
  const colors = {
    muted: String(useCSSVariable("--openbot-text-grouped-secondary")),
    accent: String(useCSSVariable("--openbot-accent")),
    danger: String(useCSSVariable("--openbot-danger-text")),
  };
  return <Icon size={20} color={colors[tone]} strokeWidth={1.75} />;
}
