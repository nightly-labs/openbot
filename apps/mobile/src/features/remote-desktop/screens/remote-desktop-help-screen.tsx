import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import ArrowDownUp from "lucide-react-native/icons/arrow-down-up";
import ClipboardList from "lucide-react-native/icons/clipboard-list";
import Command from "lucide-react-native/icons/command";
import Hand from "lucide-react-native/icons/hand";
import Keyboard from "lucide-react-native/icons/keyboard";
import List from "lucide-react-native/icons/list";
import Monitor from "lucide-react-native/icons/monitor";
import MousePointer2 from "lucide-react-native/icons/mouse-pointer-2";
import Move from "lucide-react-native/icons/move";
import SquareMousePointer from "lucide-react-native/icons/square-mouse-pointer";
import ZoomIn from "lucide-react-native/icons/zoom-in";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

/** How the remote desktop takes touch, in the words of the controls the user sees. */
export function RemoteDesktopHelpScreen() {
  const { t } = useText();
  const foreground = String(useThemeColor("foreground"));
  const row = (Icon: LucideIcon, title: string, body: string) => (
    <SettingsRow leading={<Icon color={foreground} size={20} strokeWidth={1.8} />} supportingText={body}>
      <Typography.Paragraph>{title}</Typography.Paragraph>
    </SettingsRow>
  );
  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.server.remoteDesktop.help.pointer")}>
        {row(
          MousePointer2,
          t("mobile.server.remoteDesktop.help.move.title"),
          t("mobile.server.remoteDesktop.help.move.body"),
        )}
        {row(Hand, t("mobile.server.remoteDesktop.help.click.title"), t("mobile.server.remoteDesktop.help.click.body"))}
        {row(Move, t("mobile.server.remoteDesktop.help.drag.title"), t("mobile.server.remoteDesktop.help.drag.body"))}
        {row(
          List,
          t("mobile.server.remoteDesktop.help.rightClick.title"),
          t("mobile.server.remoteDesktop.help.rightClick.body"),
        )}
        {row(
          ArrowDownUp,
          t("mobile.server.remoteDesktop.help.scroll.title"),
          t("mobile.server.remoteDesktop.help.scroll.body"),
        )}
        {row(
          SquareMousePointer,
          t("mobile.server.remoteDesktop.help.trackpad.title"),
          t("mobile.server.remoteDesktop.help.trackpad.body"),
        )}
      </SettingsSection>
      <SettingsSection title={t("mobile.server.remoteDesktop.help.view")}>
        {row(ZoomIn, t("mobile.server.remoteDesktop.help.zoom.title"), t("mobile.server.remoteDesktop.help.zoom.body"))}
        {row(
          Monitor,
          t("mobile.server.remoteDesktop.help.display.title"),
          t("mobile.server.remoteDesktop.help.display.body"),
        )}
      </SettingsSection>
      <SettingsSection title={t("mobile.server.remoteDesktop.help.typing")}>
        {row(
          Keyboard,
          t("mobile.server.remoteDesktop.help.type.title"),
          t("mobile.server.remoteDesktop.help.type.body"),
        )}
        {row(
          Command,
          t("mobile.server.remoteDesktop.help.shortcut.title"),
          t("mobile.server.remoteDesktop.help.shortcut.body"),
        )}
        {row(
          ClipboardList,
          t("mobile.server.remoteDesktop.help.paste.title"),
          t("mobile.server.remoteDesktop.help.paste.body"),
        )}
      </SettingsSection>
    </SettingsContent>
  );
}
