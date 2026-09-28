import type { AccountSession, AvatarImageInput, CentralAuthUser } from "@openbot/contracts/ipc";
import { SettingsPanel, SettingsPanelContent, SettingsPanelHeader } from "../../components/SettingsPanel";
import { useText } from "../../text";
import { ProfileNameSaveBar } from "./ProfileNameSaveBar";
import { SettingsProfileTab } from "./SettingsProfileTab";
import { createSettingsProfileStore } from "./stores/profile-store";

export interface AccountProfilePanelProps {
  account: CentralAuthUser;
  onUpdateAccountName: (name: string) => Promise<void>;
  onUpdateAccountAvatar: (image: AvatarImageInput | null) => Promise<void>;
  onListAccountSessions: () => Promise<AccountSession[]>;
  onRevokeAccountSession: (sessionId: string) => Promise<void>;
  width: number;
  maxWidth: () => number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onClose: () => void;
}

/**
 * Settings > Profile in the right side panel, for a client that has no settings dialog. The tab and
 * its store and its name save bar are the ones the desktop dialog uses.
 */
export default function AccountProfilePanel(props: AccountProfilePanelProps) {
  const { t } = useText();
  const profile = createSettingsProfileStore(
    {
      open: true,
      get account() {
        return props.account;
      },
      onUpdateAccountName: (name) => props.onUpdateAccountName(name),
      onUpdateAccountAvatar: (image) => props.onUpdateAccountAvatar(image),
      onListAccountSessions: () => props.onListAccountSessions(),
      onRevokeAccountSession: (sessionId) => props.onRevokeAccountSession(sessionId),
    },
    () => true,
  );
  return (
    <SettingsPanel
      id="account-profile-panel"
      label={t("settings.tab.profile.title")}
      width={props.width}
      maxWidth={props.maxWidth}
      onResize={props.onResize}
      onResizeEnd={props.onResizeEnd}
    >
      <SettingsPanelHeader
        title={t("settings.tab.profile.title")}
        onClose={props.onClose}
        closeLabel={t("common.close")}
      />
      <SettingsPanelContent>
        <SettingsProfileTab store={profile} account={props.account} canListSessions canRevokeSession />
      </SettingsPanelContent>
      <ProfileNameSaveBar store={profile} />
    </SettingsPanel>
  );
}
