import { useText } from "@openbot/ui/text";
import { SetupProviderPicker, type SetupProviders } from "./SetupProviderPicker";

export interface FirstRunPlanStepProps {
  providers: SetupProviders;
  disabled: boolean;
  /** The first-run screen. It sits on the dialog layer, so row menus mount in it. */
  menuMount: HTMLElement | undefined;
}

/** The plan step of first run: the plan providers to connect. The free provider is not a row. */
export function FirstRunPlanStep(props: FirstRunPlanStepProps) {
  const { t } = useText();
  return (
    <section class="onboarding-panel" aria-labelledby="onboarding-title">
      <h1 id="onboarding-title">{t("onboarding.plan.title")}</h1>
      <p class="onboarding-description">{t("onboarding.plan.description")}</p>
      <div class="onboarding-provider">
        <SetupProviderPicker
          providers={props.providers}
          ariaLabel={t("onboarding.provider.defaultLabel")}
          label={t("onboarding.provider.label")}
          hint={t("onboarding.provider.hintChange")}
          disabled={props.disabled}
          menuMount={props.menuMount}
        />
      </div>
    </section>
  );
}
