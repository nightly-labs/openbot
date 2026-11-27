import type { MenuAction } from "@/shared/components/menu-view";
import { isAndroid } from "@/shared/lib/platform";
import display from "../assets/menu-display.xml";
import fit from "../assets/menu-fit.xml";
import quality from "../assets/menu-quality.xml";
import stats from "../assets/menu-stats.xml";
import trackpad from "../assets/menu-trackpad.xml";

const ANDROID_ICONS = { display, fit, quality, stats, trackpad } as const;

export function menuIcon(
  name: keyof typeof ANDROID_ICONS,
  symbol: Extract<MenuAction["image"], string>,
): MenuAction["image"] {
  return isAndroid ? ANDROID_ICONS[name] : symbol;
}
