import { useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { SettingsPictureChoice } from "@/features/settings/components/settings-picture-choice";
import { MotionPicture } from "@/features/settings/components/settings-pictures";
import { type MotionPreference, useMotionPreferences } from "@/features/settings/model/motion";
import { saveMotionPreference } from "@/features/settings/model/motion-storage";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

export function AnimationsSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const preferences = useMotionPreferences();
  // Reduced motion, from the device or from the Reduced picture, holds the other animations off.
  const reduced = useReducedMotion();
  const [error, setError] = useState<string | null>(null);
  function save(name: MotionPreference, enabled: boolean) {
    setError(null);
    void saveMotionPreference(name, enabled).catch(() => {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }
  // The compact message field is stored with the animations but shows in Settings > Conversations.
  const animations: {
    name: Exclude<MotionPreference, "allAnimations" | "composerResize">;
    label: string;
    footer: string;
  }[] = [
    {
      name: "agentFaces",
      label: t("mobile.settings.animations.agentFaces"),
      footer: t("mobile.settings.animations.agentFacesFooter"),
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
      <SettingsSection footer={error ?? t("mobile.settings.animations.motionFooter")}>
        <SettingsPictureChoice<boolean>
          label={t("mobile.settings.animations.title")}
          value={preferences.allAnimations}
          disabled={!preferences.ready}
          options={[
            {
              value: true,
              label: t("mobile.settings.animations.fullMotion"),
              picture: (play) => <MotionPicture full play={play} />,
            },
            {
              value: false,
              label: t("mobile.settings.animations.reduced"),
              picture: (play) => <MotionPicture full={false} play={play} />,
            },
          ]}
          onChange={(enabled) => save("allAnimations", enabled)}
        />
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
