/** The bar that shows while the canvas shows a saved version, read-only, with Back and Make current. */

import { ArrowLeft, Button, History, Lock } from "@openbot/ui";
import { useText } from "../../text";

export function WorkflowVersionBar(props: {
  /** When the version was saved, as the switcher lists it. */
  at: string;
  onBack: () => void;
  onMakeCurrent: () => void;
}) {
  const { t } = useText();
  return (
    <section class="wfn-hud wfn-hud-version" aria-label={t("workflow.canvas.version.preview")}>
      <span class="wfn-hud-icon" aria-hidden="true">
        <History />
      </span>
      <span class="wfn-hud-label">{t("workflow.canvas.version.label")}</span>
      <span class="wfn-hud-meta">{props.at}</span>
      <span class="wfn-hud-separator" aria-hidden="true" />
      <span class="wfn-hud-lock">
        <Lock class="wfn-hud-lock-icon" aria-hidden="true" />
        {t("workflow.canvas.version.readOnly")}
      </span>
      <Button variant="ghost" size="sm" class="wfn-hud-button" onClick={props.onBack}>
        <ArrowLeft aria-hidden="true" />
        {t("workflow.canvas.version.back")}
      </Button>
      <Button size="sm" class="wfn-hud-button" onClick={props.onMakeCurrent}>
        {t("workflow.canvas.version.makeCurrent")}
      </Button>
    </section>
  );
}
