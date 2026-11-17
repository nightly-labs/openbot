import { AppLogo, type AppLogoVariant } from "@openbot/brand";
import type { UpdateStatus } from "@openbot/contracts/ipc";
import { createSignal, Show } from "solid-js";
import { Button } from "../../button";
import { useText } from "../../text";
import { restartReasonKey } from "./restart-reasons";
import { presentUpdateStatus } from "./update-status";

const PRODUCT_NAME = "OpenBot";

export interface UpdateRequiredScreenProps {
  /** A status with `requiredVersion`: this version is below the lowest supported one. */
  status: UpdateStatus;
  logoVariant: AppLogoVariant;
  /** The next step of the updater for the phase: check, download, retry, or restart into the update. */
  onUpdate: () => Promise<void>;
  /** Opens the download page, for an install that cannot update itself or whose update failed. */
  onOpenDownloadPage: () => void;
}

/**
 * Shown in place of the app while this version is below the lowest one that the account service
 * supports. The update downloads by itself and installs when the agents are idle; the button skips
 * the wait. It uses the layout of the sign-in screen.
 */
export function UpdateRequiredScreen(props: UpdateRequiredScreenProps) {
  const { t, format, errorMessage } = useText();
  const presentation = () => presentUpdateStatus(props.status, { t, format });
  const waitingFor = () => {
    const restart = props.status.scheduledRestart;
    if (!restart || props.status.phase !== "ready") return null;
    const reasons = restart.waitingFor.map((reason) => t(restartReasonKey(reason)));
    return reasons.length === 0
      ? t("update.idleRestart.updateTitle")
      : `${t("update.idleRestart.updateTitle")}. ${t("update.idleRestart.waitingFor", { reasons: format.list(reasons) })}`;
  };
  const [actionError, setActionError] = createSignal<string | null>(null);
  const statusError = () =>
    props.status.phase === "error" && props.status.message
      ? errorMessage(props.status.message, t("update.required.failed"))
      : null;
  const failure = () => actionError() ?? statusError();
  async function update(): Promise<void> {
    setActionError(null);
    try {
      await props.onUpdate();
    } catch (cause) {
      setActionError(errorMessage(cause, t("update.required.failed")));
    }
  }

  return (
    <main class="account-login-screen">
      <div class="account-login-shell">
        <header class="account-login-brand-lockup">
          <AppLogo variant={props.logoVariant} animation="blink" interactive class="account-login-logo" />
          <span class="account-login-wordmark">{PRODUCT_NAME}</span>
        </header>
        <section
          class="account-login"
          aria-labelledby="update-required-title"
          aria-describedby="update-required-description"
        >
          <h1 id="update-required-title" class="account-login-title">
            {t("update.required.title")}
          </h1>
          <p id="update-required-description" class="account-login-description">
            {t("update.required.description", {
              version: props.status.currentVersion,
              minimum: props.status.requiredVersion ?? "",
            })}
          </p>
          <Show when={failure()}>{(message) => <p class="account-login-error">{message()}</p>}</Show>
          <Show
            when={presentation().supported}
            fallback={
              <Button variant="default" type="button" class="account-login-primary" onClick={props.onOpenDownloadPage}>
                {t("update.required.download")}
              </Button>
            }
          >
            <p class="account-login-description" role="status">
              {waitingFor() ?? presentation().detail}
            </p>
            <Button
              variant="default"
              type="button"
              class="account-login-primary"
              loading={presentation().busy}
              loadingLabel={presentation().actionLabel}
              onClick={() => void update()}
            >
              {presentation().actionLabel}
            </Button>
            <div class="account-login-code-actions">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="account-login-code-action"
                onClick={props.onOpenDownloadPage}
              >
                {t("update.required.download")}
              </Button>
            </div>
          </Show>
        </section>
      </div>
    </main>
  );
}
