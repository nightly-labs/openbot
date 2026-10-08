import type { AppTextKey } from "@openbot/i18n";
import {
  Bell,
  CircleArrowDown,
  CreditCard,
  MousePointer2,
  PanelTop,
  Server,
  Settings,
  Smartphone,
  UserRound,
} from "@openbot/ui";

export type SettingsTab =
  | "general"
  | "notifications"
  | "dynamic-island"
  | "computer-use"
  | "profile"
  | "billing"
  | "mobile-connect"
  | "updates"
  | "hosted-servers";

/**
 * A tab holds the keys of its label and its header text, not the text itself. The list is read at
 * module level, before any component exists to translate it, and a label captured there would keep
 * the language the app started in.
 */
type SettingsNavItem = {
  value: SettingsTab;
  titleKey: AppTextKey;
  descriptionKey: AppTextKey;
  icon: typeof Settings;
};

export const navItems: ReadonlyArray<SettingsNavItem> = [
  {
    value: "general",
    titleKey: "settings.tab.general.title",
    descriptionKey: "settings.tab.general.description",
    icon: Settings,
  },
  {
    value: "notifications",
    titleKey: "settings.tab.notifications.title",
    descriptionKey: "settings.tab.notifications.description",
    icon: Bell,
  },
  {
    value: "dynamic-island",
    titleKey: "settings.tab.dynamicIsland.title",
    descriptionKey: "settings.tab.dynamicIsland.description",
    icon: PanelTop,
  },
  {
    value: "computer-use",
    titleKey: "settings.tab.computerUse.title",
    descriptionKey: "settings.tab.computerUse.description",
    icon: MousePointer2,
  },
  {
    value: "profile",
    titleKey: "settings.tab.profile.title",
    descriptionKey: "settings.tab.profile.description",
    icon: UserRound,
  },
  {
    value: "billing",
    titleKey: "settings.tab.billing.title",
    descriptionKey: "settings.tab.billing.description",
    icon: CreditCard,
  },
  {
    value: "mobile-connect",
    titleKey: "settings.tab.mobileConnect.title",
    descriptionKey: "settings.tab.mobileConnect.description",
    icon: Smartphone,
  },
  {
    value: "updates",
    titleKey: "settings.tab.updates.title",
    descriptionKey: "settings.tab.updates.description",
    icon: CircleArrowDown,
  },
  {
    value: "hosted-servers",
    titleKey: "settings.tab.hostedServers.title",
    descriptionKey: "settings.tab.hostedServers.description",
    icon: Server,
  },
];

export function navItem(tab: SettingsTab): SettingsNavItem {
  const found = navItems.find((item) => item.value === tab);
  if (!found) throw new Error(`Unknown settings tab: ${tab}`);
  return found;
}
