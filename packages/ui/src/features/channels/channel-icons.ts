import { type AvatarHue, type ChannelIcon, type ChannelIconName, isAvatarHue } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  BookOpen,
  Brain,
  BriefcaseBusiness,
  CalendarClock,
  ChartArea,
  Code,
  CreditCard,
  Gift,
  Globe2,
  LifeBuoy,
  Mail,
  Megaphone,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Workflow,
  Zap,
} from "@openbot/ui";

/**
 * The glyph of each icon a reader can give a channel. `CHANNEL_ICON_NAMES` in the contracts owns the
 * names and their order, so the agent tools accept the same set. A saved name that this version does
 * not know shows the member faces.
 */
export const CHANNEL_ICONS = {
  megaphone: { component: Megaphone, label: "channel.picture.icon.megaphone" },
  chart: { component: ChartArea, label: "channel.picture.icon.chart" },
  lifebuoy: { component: LifeBuoy, label: "channel.picture.icon.lifebuoy" },
  search: { component: Search, label: "channel.picture.icon.search" },
  briefcase: { component: BriefcaseBusiness, label: "channel.picture.icon.briefcase" },
  code: { component: Code, label: "channel.picture.icon.code" },
  globe: { component: Globe2, label: "channel.picture.icon.globe" },
  mail: { component: Mail, label: "channel.picture.icon.mail" },
  calendar: { component: CalendarClock, label: "channel.picture.icon.calendar" },
  gift: { component: Gift, label: "channel.picture.icon.gift" },
  palette: { component: Palette, label: "channel.picture.icon.palette" },
  brain: { component: Brain, label: "channel.picture.icon.brain" },
  book: { component: BookOpen, label: "channel.picture.icon.book" },
  sparkles: { component: Sparkles, label: "channel.picture.icon.sparkles" },
  star: { component: Star, label: "channel.picture.icon.star" },
  zap: { component: Zap, label: "channel.picture.icon.zap" },
  shield: { component: ShieldCheck, label: "channel.picture.icon.shield" },
  store: { component: Store, label: "channel.picture.icon.store" },
  workflow: { component: Workflow, label: "channel.picture.icon.workflow" },
  card: { component: CreditCard, label: "channel.picture.icon.card" },
} as const satisfies Record<ChannelIconName, { component: unknown; label: AppTextKey }>;

/** The colour of a new icon, before the reader chooses one. */
export const DEFAULT_CHANNEL_ICON_HUE: AvatarHue = 215;

function isChannelIconName(name: string): name is ChannelIconName {
  return Object.hasOwn(CHANNEL_ICONS, name);
}

/** A saved icon this version can draw, or null. A hue from a later version takes the default colour. */
export function knownChannelIcon(
  icon: ChannelIcon | null | undefined,
): { name: ChannelIconName; hue: AvatarHue } | null {
  if (!icon || !isChannelIconName(icon.name)) return null;
  return { name: icon.name, hue: isAvatarHue(icon.hue) ? icon.hue : DEFAULT_CHANNEL_ICON_HUE };
}
