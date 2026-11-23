import { SwitchField } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { setMotionEffect, useMotionEffect } from "../../motion-preference";
import { setStartupAnimation, useStartupAnimation } from "../../startup-animation-preference";

export function MotionSwitches() {
  const { t } = useText();
  const backgroundBlur = useMotionEffect("backgroundBlur");
  const movingFaces = useMotionEffect("movingFaces");
  const startupAnimation = useStartupAnimation();
  return (
    <>
      <SwitchField
        data-settings-row="settings.backgroundBlur.title"
        checked={backgroundBlur()}
        onChange={(on) => setMotionEffect("backgroundBlur", on)}
        label={t("settings.backgroundBlur.title")}
        description={t("settings.backgroundBlur.description")}
      />
      <SwitchField
        data-settings-row="settings.movingFaces.title"
        checked={movingFaces()}
        onChange={(on) => setMotionEffect("movingFaces", on)}
        label={t("settings.movingFaces.title")}
        description={t("settings.movingFaces.description")}
      />
      <SwitchField
        data-settings-row="settings.startupAnimation.title"
        checked={startupAnimation()}
        onChange={setStartupAnimation}
        label={t("settings.startupAnimation.title")}
        description={t("settings.startupAnimation.description")}
      />
    </>
  );
}
