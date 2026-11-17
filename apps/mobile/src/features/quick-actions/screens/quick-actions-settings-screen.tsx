import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import {
  loadQuickActionChoice,
  QUICK_ACTION_KINDS,
  QUICK_ACTION_LIMIT,
  type QuickActionKind,
  saveQuickActionKind,
  useQuickActionChoice,
} from "../model/quick-action-choice";

const LABELS = {
  latestChat: "mobile.settings.quickActions.latestChat",
  secondChat: "mobile.settings.quickActions.secondChat",
  schedule: "mobile.app.route.schedule",
  search: "mobile.app.quickAction.search",
  share: "mobile.app.quickAction.share",
  // The same title as the icon menu, so the user finds the item that they saw there.
  support: "mobile.app.quickAction.support",
} as const satisfies Record<QuickActionKind, MobileTextKey>;

/** Settings > App Icon Menu: the quick actions that the phone shows when the user holds the app icon. */
export function QuickActionsSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const kinds = useQuickActionChoice((state) => state.kinds);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadQuickActionChoice();
  }, []);
  const full = (kinds?.length ?? 0) >= QUICK_ACTION_LIMIT;
  function save(kind: QuickActionKind, enabled: boolean) {
    setError(null);
    void saveQuickActionKind(kind, enabled).catch(() => {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }
  return (
    <SettingsContent>
      <SettingsSection footer={error ?? t("mobile.settings.quickActions.footer", { count: QUICK_ACTION_LIMIT })}>
        {QUICK_ACTION_KINDS.map((kind) => {
          const on = kinds?.includes(kind) ?? false;
          return (
            <SettingsRow key={kind}>
              <SettingsSwitch
                value={on}
                // At the limit, the user turns an item off before another one goes on.
                disabled={!kinds || (!on && full)}
                label={t(LABELS[kind])}
                dark={theme === "dark"}
                onValueChange={(enabled) => save(kind, enabled)}
              />
            </SettingsRow>
          );
        })}
      </SettingsSection>
    </SettingsContent>
  );
}
