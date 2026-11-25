import { AppLogo, type AppLogoVariant } from "@openbot/brand";
import type { UpdateStatus } from "@openbot/contracts/ipc";
import { createSignal, Show } from "solid-js";
import { Button } from "../../button";
import { TriangleAlert } from "../../icons";
import { Progress } from "../../progress";
import { useText } from "../../text";
import { restartReasonKey } from "./restart-reasons";
import { presentUpdateStatus } from "./update-status";

const PRODUCT_NAME = "OpenBot";

export interface UpdateRequiredScreenProps {
  status: UpdateStatus;
  logoVariant: AppLogoVariant;
  onUpdate: () => Promise<void>;
  onOpenDownloadPage: () => void;
  onDismiss?: () => void;
}

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
  const working = () => presentation().busy && props.status.phase !== "ready";
  const progress = () => (props.status.phase === "downloading" ? props.status.progress : null);
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
          class="account-login update-required"
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
          <Show when={failure()}>
            {(message) => (
              <p class="update-required-note update-required-error" role="alert">
                <TriangleAlert class="update-required-error-icon" aria-hidden="true" />
                {message()}
              </p>
            )}
          </Show>
          <Show
            when={presentation().supported}
            fallback={
              <>
                <Button
                  variant="default"
                  type="button"
                  class="account-login-primary"
                  onClick={props.onOpenDownloadPage}
                >
                  {t("update.required.download")}
                </Button>
                <Show when={props.onDismiss}>
                  {(dismiss) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      class="update-required-secondary"
                      onClick={dismiss()}
                    >
                      {t("update.required.continue")}
                    </Button>
                  )}
                </Show>
              </>
            }
          >
            <Show
              when={working()}
              fallback={
                <>
                  <Show when={waitingFor()}>
                    {(text) => (
                      <p class="update-required-note" role="status">
                        {text()}
                      </p>
                    )}
                  </Show>
                  <Button variant="default" type="button" class="account-login-primary" onClick={() => void update()}>
                    {presentation().actionLabel}
                  </Button>
                </>
              }
            >
              <div class="update-required-progress" role="status">
                <div class="update-required-progress-label">
                  <span>{presentation().actionLabel}</span>
                  <Show when={progress() !== null}>
                    <span class="update-required-progress-value">{presentation().detail}</span>
                  </Show>
                </div>
                <Progress
                  value={progress() ?? 0}
                  indeterminate={progress() === null}
                  aria-label={presentation().actionLabel}
                />
              </div>
            </Show>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              class="update-required-secondary"
              onClick={props.onOpenDownloadPage}
            >
              {t("update.required.download")}
            </Button>
            <Show when={failure() !== null && props.onDismiss}>
              {(dismiss) => (
                <Button variant="ghost" size="sm" type="button" class="update-required-secondary" onClick={dismiss()}>
                  {t("update.required.continue")}
                </Button>
              )}
            </Show>
          </Show>
        </section>
      </div>
    </main>
  );
}
