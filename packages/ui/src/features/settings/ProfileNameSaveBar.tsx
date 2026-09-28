import { Button, Text } from "@openbot/ui";
import { useText } from "../../text";
import { SaveBarDock } from "./SettingsDialogShell";
import type { SettingsProfileStore } from "./stores/profile-store";

/** The Profile display name's Reset and Save bar, for the settings dialog footer and the side panel. */
export function ProfileNameSaveBar(props: { store: SettingsProfileStore }) {
  const { t } = useText();
  return (
    <SaveBarDock value={props.store.nameDirty() ? true : null}>
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
              disabled={props.store.state.profile.busy}
              onClick={props.store.resetName}
            >
              {t("settings.save.reset")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              loading={props.store.state.profile.busy}
              loadingLabel={t("common.saving")}
              disabled={props.store.state.profile.busy}
              onClick={() => void props.store.saveName()}
            >
              {t("common.save")}
            </Button>
          </div>
        </section>
      )}
    </SaveBarDock>
  );
}
