import {
  type AvatarHue,
  CHANNEL_ICON_NAMES,
  type ChannelIcon,
  type ChannelIconName,
  isAvatarHue,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import type { LucideIcon } from "lucide-react-native";
import BookOpen from "lucide-react-native/icons/book-open";
import Brain from "lucide-react-native/icons/brain";
import BriefcaseBusiness from "lucide-react-native/icons/briefcase-business";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartArea from "lucide-react-native/icons/chart-area";
import Code from "lucide-react-native/icons/code";
import CreditCard from "lucide-react-native/icons/credit-card";
import Earth from "lucide-react-native/icons/earth";
import Gift from "lucide-react-native/icons/gift";
import LifeBuoy from "lucide-react-native/icons/life-buoy";
import Mail from "lucide-react-native/icons/mail";
import Megaphone from "lucide-react-native/icons/megaphone";
import Palette from "lucide-react-native/icons/palette";
import Search from "lucide-react-native/icons/search";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Sparkles from "lucide-react-native/icons/sparkles";
import Star from "lucide-react-native/icons/star";
import Store from "lucide-react-native/icons/store";
import Workflow from "lucide-react-native/icons/workflow";
import Zap from "lucide-react-native/icons/zap";

/**
 * The glyph and name of each channel icon, as the desktop channel settings draw them. The contracts
 * own the names and their order; a saved name that this version does not know shows the member faces.
 */
export const CHANNEL_ICONS = {
  megaphone: { glyph: Megaphone, label: "mobile.channel.picture.icon.megaphone" },
  chart: { glyph: ChartArea, label: "mobile.channel.picture.icon.chart" },
  lifebuoy: { glyph: LifeBuoy, label: "mobile.channel.picture.icon.lifebuoy" },
  search: { glyph: Search, label: "mobile.channel.picture.icon.search" },
  briefcase: { glyph: BriefcaseBusiness, label: "mobile.channel.picture.icon.briefcase" },
  code: { glyph: Code, label: "mobile.channel.picture.icon.code" },
  globe: { glyph: Earth, label: "mobile.channel.picture.icon.globe" },
  mail: { glyph: Mail, label: "mobile.channel.picture.icon.mail" },
  calendar: { glyph: CalendarClock, label: "mobile.channel.picture.icon.calendar" },
  gift: { glyph: Gift, label: "mobile.channel.picture.icon.gift" },
  palette: { glyph: Palette, label: "mobile.channel.picture.icon.palette" },
  brain: { glyph: Brain, label: "mobile.channel.picture.icon.brain" },
  book: { glyph: BookOpen, label: "mobile.channel.picture.icon.book" },
  sparkles: { glyph: Sparkles, label: "mobile.channel.picture.icon.sparkles" },
  star: { glyph: Star, label: "mobile.channel.picture.icon.star" },
  zap: { glyph: Zap, label: "mobile.channel.picture.icon.zap" },
  shield: { glyph: ShieldCheck, label: "mobile.channel.picture.icon.shield" },
  store: { glyph: Store, label: "mobile.channel.picture.icon.store" },
  workflow: { glyph: Workflow, label: "mobile.channel.picture.icon.workflow" },
  card: { glyph: CreditCard, label: "mobile.channel.picture.icon.card" },
} as const satisfies Record<ChannelIconName, { glyph: LucideIcon; label: MobileTextKey }>;

/** The colour of a new icon, before the reader chooses one, as on the desktop. */
export const DEFAULT_CHANNEL_ICON_HUE: AvatarHue = 215;

function isChannelIconName(name: string): name is ChannelIconName {
  return CHANNEL_ICON_NAMES.some((known) => known === name);
}

/** A saved icon this version can draw, or null. A hue from a later version takes the default colour. */
export function knownChannelIcon(
  icon: ChannelIcon | null | undefined,
): { name: ChannelIconName; hue: AvatarHue } | null {
  if (!icon || !isChannelIconName(icon.name)) return null;
  return { name: icon.name, hue: isAvatarHue(icon.hue) ? icon.hue : DEFAULT_CHANNEL_ICON_HUE };
}
