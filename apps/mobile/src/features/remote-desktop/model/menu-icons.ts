import type { MenuAction } from "@/shared/components/menu-view";
import { isAndroid } from "@/shared/lib/platform";
import display from "../assets/menu-display.xml";
import fit from "../assets/menu-fit.xml";
import quality from "../assets/menu-quality.xml";
import stats from "../assets/menu-stats.xml";
import trackpad from "../assets/menu-trackpad.xml";

// Android shows a menu item's icon only from an image source: it ignores an SF Symbol name. These
// vector drawables are the Lucide icons that the app uses elsewhere, and the menu tints them.
const ANDROID_ICONS = { display, fit, quality, stats, trackpad } as const;

/** The icon of an item of the ••• menu: the SF Symbol on iOS, the vector drawable on Android. */
export function menuIcon(
  name: keyof typeof ANDROID_ICONS,
  symbol: Extract<MenuAction["image"], string>,
): MenuAction["image"] {
  return isAndroid ? ANDROID_ICONS[name] : symbol;
}
