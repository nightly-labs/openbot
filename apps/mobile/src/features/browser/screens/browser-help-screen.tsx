import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import {
  ArrowDownUp,
  ArrowLeftRight,
  ClipboardList,
  Copy,
  Keyboard,
  List,
  type LucideIcon,
  MousePointer2,
  SquareMousePointer,
  Undo2,
  ZoomIn,
} from "lucide-react-native";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

/** How the live browser takes touch, in the words of the controls the user sees. */
export function BrowserHelpScreen() {
  const { t } = useText();
  const foreground = String(useThemeColor("foreground"));
  const row = (Icon: LucideIcon, title: string, body: string) => (
    <SettingsRow leading={<Icon color={foreground} size={20} strokeWidth={1.8} />} supportingText={body}>
      <Typography.Paragraph>{title}</Typography.Paragraph>
    </SettingsRow>
  );
  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.browser.help.movingAround")}>
        {row(ArrowDownUp, t("mobile.browser.help.scroll.title"), t("mobile.browser.help.scroll.body"))}
        {row(MousePointer2, t("mobile.browser.help.click.title"), t("mobile.browser.help.click.body"))}
        {row(List, t("mobile.browser.help.rightClick.title"), t("mobile.browser.help.rightClick.body"))}
        {row(ZoomIn, t("mobile.browser.help.zoom.title"), t("mobile.browser.help.zoom.body"))}
      </SettingsSection>
      <SettingsSection title={t("mobile.browser.help.pages")}>
        {row(ArrowLeftRight, t("mobile.browser.help.navigate.title"), t("mobile.browser.help.navigate.body"))}
        {row(Copy, t("mobile.browser.help.tabs.title"), t("mobile.browser.help.tabs.body"))}
      </SettingsSection>
      <SettingsSection title={t("mobile.browser.help.typing")}>
        {row(Keyboard, t("mobile.browser.help.type.title"), t("mobile.browser.help.type.body"))}
        {row(ClipboardList, t("mobile.browser.help.clipboard.title"), t("mobile.browser.help.clipboard.body"))}
      </SettingsSection>
      <SettingsSection title={t("mobile.browser.help.pointer")}>
        {row(SquareMousePointer, t("mobile.browser.help.trackpad.title"), t("mobile.browser.help.trackpad.body"))}
      </SettingsSection>
      <SettingsSection title={t("mobile.browser.help.handingBack")}>
        {row(Undo2, t("mobile.browser.help.handBack.title"), t("mobile.browser.help.handBack.body"))}
      </SettingsSection>
    </SettingsContent>
  );
}
