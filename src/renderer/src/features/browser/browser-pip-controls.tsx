import { render } from "@solidjs/web";
import { Button, PanelRight, X } from "../../components/ui";
import "../../styles.css";
import { useI18n } from "../i18n/i18n-context";

function BrowserPictureInPictureControls() {
  const { t } = useI18n();
  return (
    <div class="browser-pip-hover-controls" role="toolbar" aria-label={t("browser.windowControls")}>
      <Button
        variant="ghost"
        type="button"
        class="browser-pip-hover-button"
        aria-label={t("browser.reattach")}
        title={t("browser.reattach")}
        onClick={() => void window.openbot.browser.dockPictureInPicture()}
      >
        <PanelRight class="browser-toolbar-icon" />
      </Button>
      <Button
        variant="ghost"
        type="button"
        class="browser-pip-hover-button"
        aria-label={t("browser.closePopup")}
        title={t("browser.closePopup")}
        onClick={() => void window.openbot.browser.hidePictureInPicture()}
      >
        <X class="browser-toolbar-icon" />
      </Button>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Browser Picture in Picture controls root was not found.");
render(() => <BrowserPictureInPictureControls />, root);
