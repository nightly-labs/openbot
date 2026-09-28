import type { AccountSession, AvatarImageInput, CentralAuthUser } from "@openbot/contracts/ipc";
import { Button, Text } from "@openbot/ui";
import { SettingsPanel, SettingsPanelContent, SettingsPanelHeader } from "../../components/SettingsPanel";
import { useText } from "../../text";
import { SaveBarDock } from "./SettingsDialogShell";
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
 * its store are the desktop ones; the panel adds the name save bar that the dialog footer holds.
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
      <SaveBarDock value={profile.nameDirty() ? true : null}>
        {() => (
          <section class="settings-modal-save-bar" aria-label={t("settings.save.region")}>
            <Text variant="caption" tone="muted">
              {t("settings.save.notSaved")}
            </Text>
            <div class="settings-modal-save-actions">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={profile.state.profile.busy}
                onClick={profile.resetName}
              >
                {t("settings.save.reset")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                loading={profile.state.profile.busy}
                loadingLabel={t("common.saving")}
                disabled={profile.state.profile.busy}
                onClick={() => void profile.saveName()}
              >
                {t("common.save")}
              </Button>
            </div>
          </section>
        )}
      </SaveBarDock>
    </SettingsPanel>
  );
}
