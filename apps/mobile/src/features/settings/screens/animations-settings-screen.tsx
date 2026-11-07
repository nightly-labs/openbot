import { useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { type MotionPreference, useMotionPreferences } from "@/features/settings/model/motion";
import { saveMotionPreference } from "@/features/settings/model/motion-storage";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

export function AnimationsSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const preferences = useMotionPreferences();
  // Reduced motion, from the device or from the first switch, holds the other animations off.
  const reduced = useReducedMotion();
  const [error, setError] = useState<string | null>(null);
  function save(name: MotionPreference, enabled: boolean) {
    setError(null);
    void saveMotionPreference(name, enabled).catch(() => {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }
  const animations: { name: Exclude<MotionPreference, "allAnimations">; label: string; footer: string }[] = [
    {
      name: "agentFaces",
      label: t("mobile.settings.animations.agentFaces"),
      footer: t("mobile.settings.animations.agentFacesFooter"),
    },
    {
      name: "composerResize",
      label: t("mobile.settings.animations.composerResize"),
      footer: t("mobile.settings.animations.composerResizeFooter"),
    },
    {
      name: "textReveal",
      label: t("mobile.settings.animations.textReveal"),
      footer: t("mobile.settings.animations.textRevealFooter"),
    },
    {
      name: "searchTransitions",
      label: t("mobile.settings.animations.searchTransitions"),
      footer: t("mobile.settings.animations.searchTransitionsFooter"),
    },
  ];
  return (
    <SettingsContent>
      <SettingsSection footer={error ?? t("mobile.settings.animations.footer")}>
        <SettingsRow>
          <SettingsSwitch
            value={preferences.allAnimations}
            disabled={!preferences.ready}
            label={t("mobile.settings.animations.all")}
            dark={theme === "dark"}
            onValueChange={(enabled) => save("allAnimations", enabled)}
          />
        </SettingsRow>
      </SettingsSection>
      {animations.map((animation) => (
        <SettingsSection key={animation.name} footer={animation.footer}>
          <SettingsRow>
            <SettingsSwitch
              value={preferences[animation.name] && !reduced}
              disabled={!preferences.ready || reduced}
              label={animation.label}
              dark={theme === "dark"}
              onValueChange={(enabled) => save(animation.name, enabled)}
            />
          </SettingsRow>
        </SettingsSection>
      ))}
    </SettingsContent>
  );
}
