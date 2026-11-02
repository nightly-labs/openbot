import { IconButton, PanelRight, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { render } from "@solidjs/web";
import { createSignal } from "solid-js";
import "../../styles.css";
import { syncAppearance } from "../../appearance-choice";
import { I18nProvider } from "../../i18n-context";
import { browserPort } from "./browser-port";

/**
 * The controls are a 30-pixel overlay view with no toaster, so a failed action is announced in a
 * live region. A visible toast would need the main window.
 */
function BrowserPictureInPictureControls() {
  const { t, errorMessage } = useText();
  const [failure, setFailure] = createSignal("");

  function run(action: () => Promise<void>, fallback: string): void {
    setFailure("");
    action().catch((error: unknown) => setFailure(errorMessage(error, fallback)));
  }

  return (
    <div class="browser-pip-hover-controls" role="toolbar" aria-label={t("browser.pip.controls")}>
      <IconButton
        variant="ghost"
        type="button"
        class="browser-pip-hover-button"
        label={t("browser.pip.reattach")}
        tooltip={t("browser.pip.reattachTitle")}
        onClick={() => run(() => browserPort().browser.dockPictureInPicture(), t("browser.pip.reattachFailed"))}
      >
        <PanelRight class="browser-toolbar-icon" />
      </IconButton>
      <IconButton
        variant="ghost"
        type="button"
        class="browser-pip-hover-button"
        label={t("browser.pip.close")}
        onClick={() => run(() => browserPort().browser.hidePictureInPicture(), t("browser.pip.closeFailed"))}
      >
        <X class="browser-toolbar-icon" />
      </IconButton>
      <span class="sr-only" role="alert">
        {failure()}
      </span>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Browser Picture in Picture controls root was not found.");
syncAppearance();
render(
  () => (
    <I18nProvider>
      <BrowserPictureInPictureControls />
    </I18nProvider>
  ),
  root,
);
