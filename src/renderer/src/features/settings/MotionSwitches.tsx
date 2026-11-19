import { SwitchField } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { setMotionEffect, useMotionEffect } from "../../motion-preference";

export function MotionSwitches() {
  const { t } = useText();
  const backgroundBlur = useMotionEffect("backgroundBlur");
  const movingFaces = useMotionEffect("movingFaces");
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
    </>
  );
}
