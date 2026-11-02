import { Button, IconButton, X } from "@openbot/ui";
import { useText } from "../../text";
import { DiscordMark, XMark } from "../settings/brand-marks";

/**
 * The invitation to the OpenBot community at the bottom of the sidebar. It uses the quiet card of
 * the mobile app announcement. Discord is the main action; X is an icon button beside it.
 */
export function SidebarCommunityCard(props: {
  onJoinDiscord: () => void;
  onFollowX: () => void;
  onDismiss: () => void;
}) {
  const { t } = useText();
  return (
    <section class="sidebar-mobile-app" aria-labelledby="sidebar-community-title">
      <div class="sidebar-mobile-app-header">
        <DiscordMark class="sidebar-mobile-app-icon" />
        <strong id="sidebar-community-title">{t("sidebar.community.title")}</strong>
        <IconButton
          class="sidebar-mobile-app-dismiss"
          size="icon-xs"
          variant="ghost"
          label={t("sidebar.community.dismiss")}
          data-cuelume-tap="close"
          onClick={() => props.onDismiss()}
        >
          <X aria-hidden="true" />
        </IconButton>
      </div>
      <p class="sidebar-mobile-app-body">{t("sidebar.community.body")}</p>
      <div class="sidebar-community-actions">
        <Button type="button" variant="secondary" size="sm" onClick={() => props.onJoinDiscord()}>
          <DiscordMark class="sidebar-community-mark" />
          {t("sidebar.community.joinDiscord")}
        </Button>
        <IconButton
          variant="secondary"
          size="icon-sm"
          label={t("sidebar.community.followX")}
          onClick={() => props.onFollowX()}
        >
          <XMark class="sidebar-community-mark" />
        </IconButton>
      </div>
    </section>
  );
}
