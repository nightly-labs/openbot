import { Button, IconButton, X } from "@openbot/ui";
import { createUniqueId, Show } from "solid-js";
import { Star } from "../../icons";
import { currentText } from "../../text";
import { GitHubMark } from "../settings/brand-marks";

interface GitHubStarToastProps {
  /** True after the user chose to star. The toast then thanks them in place of the question. */
  thanked: boolean;
  onStar: () => void;
  onClose: () => void;
}

/**
 * The one-time request for a GitHub star. Raise it unstyled, with sonner's own timer and close
 * button off (`duration: Infinity`), in the `github-star-toast-host` class. The caller holds the
 * `thanked` state: sonner renders the content more than once, and each copy would get its own.
 */
export function GitHubStarToast(props: GitHubStarToastProps) {
  // The app's Toaster renders outside the text provider, so `useText()` would always give English.
  const { t } = currentText();
  const titleId = `github-star-toast-${createUniqueId()}`;
  return (
    <section class="github-star-toast" aria-labelledby={titleId}>
      <IconButton
        class="github-star-toast-close"
        size="icon-xs"
        variant="ghost"
        label={t("common.close")}
        onClick={() => props.onClose()}
      >
        <X aria-hidden="true" />
      </IconButton>
      <Show
        when={props.thanked}
        fallback={
          <>
            <div class="github-star-toast-head">
              <GitHubMark class="github-star-toast-mark" />
              <strong id={titleId}>{t("app.githubStar.title")}</strong>
            </div>
            <p class="github-star-toast-body">{t("app.githubStar.description")}</p>
            <div class="github-star-toast-actions">
              <Button type="button" variant="ghost" size="sm" onClick={() => props.onClose()}>
                {t("app.githubStar.notNow")}
              </Button>
              <Button type="button" variant="default" size="sm" onClick={() => props.onStar()}>
                <Star class="github-star-toast-star" aria-hidden="true" />
                {t("app.githubStar.star")}
              </Button>
            </div>
          </>
        }
      >
        <div class="github-star-toast-head" role="status">
          <Star class="github-star-toast-star github-star-toast-mark" aria-hidden="true" />
          <strong id={titleId}>{t("app.githubStar.thanksTitle")}</strong>
        </div>
        <p class="github-star-toast-body">{t("app.githubStar.thanksBody")}</p>
      </Show>
    </section>
  );
}
