import { useText } from "@openbot/ui/text";
import { SetupProviderPicker, type SetupProviders } from "./SetupProviderPicker";

export interface FirstRunPlanStepProps {
  providers: SetupProviders;
  disabled: boolean;
  menuMount: HTMLElement | undefined;
}

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
