import { Button, PanelRight, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { render } from "@solidjs/web";
import "../../styles.css";
import { I18nProvider } from "../../i18n-context";
import { browserPort } from "./browser-port";

function BrowserPictureInPictureControls() {
  const { t } = useText();
  return (
    <div class="browser-pip-hover-controls" role="toolbar" aria-label={t("browser.pip.controls")}>
      <Button
        variant="ghost"
        type="button"
        class="browser-pip-hover-button"
        aria-label={t("browser.pip.reattach")}
        title={t("browser.pip.reattachTitle")}
        onClick={() => void browserPort().browser.dockPictureInPicture()}
      >
        <PanelRight class="browser-toolbar-icon" />
      </Button>
      <Button
        variant="ghost"
        type="button"
        class="browser-pip-hover-button"
        aria-label={t("browser.pip.close")}
        title={t("browser.pip.close")}
        onClick={() => void browserPort().browser.hidePictureInPicture()}
      >
        <X class="browser-toolbar-icon" />
      </Button>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Browser Picture in Picture controls root was not found.");
render(
  () => (
    <I18nProvider>
      <BrowserPictureInPictureControls />
    </I18nProvider>
  ),
  root,
);
