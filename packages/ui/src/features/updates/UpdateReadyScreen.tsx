import { AppLogo } from "@openbot/brand";
import { Button, Dialog, Progress } from "@openbot/ui";
import { createEffect, Show } from "solid-js";
import { useText } from "../../text";

export type UpdateReadyPhase = "ready" | "installing" | "failed" | "interrupted" | "success";

export interface UpdateReadyScreenProps {
  phase: UpdateReadyPhase;
  currentVersion: string;
  targetVersion: string | null;
  pending: boolean;
  error: string | null;
  waiting: string | null;
  onRestart: () => void;
  onRestartWhenIdle: () => void;
  onCancelRestart: () => void;
  onDismiss: () => void;
}

/** The Focused concept, with real updater state supplied by the desktop. */
export function UpdateReadyScreen(props: UpdateReadyScreenProps) {
  const { t } = useText();
  let root: HTMLElement | undefined;
  let primary: HTMLButtonElement | undefined;
  const title = () => {
    switch (props.phase) {
      case "installing":
        return t("update.action.restarting");
      case "failed":
        return t("update.screen.failed");
      case "interrupted":
        return t("update.screen.interrupted");
      case "success":
        return t("update.upToDate");
      default:
        return t("update.screen.ready");
    }
  };
  const description = () => {
    switch (props.phase) {
      case "installing":
        return t("update.screen.restartingBody");
      case "failed":
        return t("update.screen.failedBody");
      case "interrupted":
        return t("update.screen.interruptedBody");
      case "success":
        return t("update.screen.successBody", { version: props.currentVersion });
      default:
        return t("update.screen.readyBody");
    }
  };
  createEffect(
    () => `${props.phase}:${props.waiting !== null}:${props.pending}`,
    () => {
      if (!root?.contains(document.activeElement) || document.activeElement?.hasAttribute("disabled")) {
        (primary?.disabled ? root : (primary ?? root))?.focus();
      }
    },
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onDismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Content
          as="section"
          ref={root}
          class="update-ready"
          tabindex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (primary ?? root)?.focus();
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div class="update-ready__stage">
            <div class="update-ready__mark">
              <AppLogo variant="production" animation="none" class="update-ready__logo" />
            </div>
            <Dialog.Title as="h1" class="update-ready__title">
              {title()}
            </Dialog.Title>
            <Dialog.Description class="update-ready__body">{description()}</Dialog.Description>
            <p class="update-ready__sr-only" role="status" aria-live="polite">
              {title()}
            </p>
            <Show when={props.phase === "ready" || props.phase === "installing"}>
              <Progress
                class="update-ready__progress"
                value={100}
                indeterminate={props.phase === "installing"}
                aria-label={title()}
              />
            </Show>
            <p class="update-ready__version">
              {t("update.screen.currentVersion", { version: props.currentVersion })}
              <Show when={props.targetVersion && props.phase !== "success"}>
                {" · "}
                {t("update.screen.targetVersion", { version: props.targetVersion ?? "" })}
              </Show>
            </p>
            <Show when={props.error}>
              <p class="update-ready__body" role="alert">
                {props.error}
              </p>
            </Show>
            <Show when={props.waiting}>
              <p class="update-ready__body" role="status">
                {props.waiting}
              </p>
            </Show>
            <div class="update-ready__actions">
              <Button size="lg" variant="ghost" onClick={props.onDismiss}>
                {props.phase === "ready" ? t("update.screen.later") : t("common.close")}
              </Button>
              <Show when={props.phase === "ready"}>
                <Show
                  when={props.waiting === null}
                  fallback={
                    <Button ref={primary} size="lg" disabled={props.pending} onClick={props.onCancelRestart}>
                      {t("update.idleRestart.cancel")}
                    </Button>
                  }
                >
                  <Button size="lg" variant="outline" disabled={props.pending} onClick={props.onRestartWhenIdle}>
                    {t("settings.updates.idleRestart.update")}
                  </Button>
                  <Button ref={primary} size="lg" disabled={props.pending} onClick={props.onRestart}>
                    {t("update.action.restart")}
                  </Button>
                </Show>
              </Show>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
