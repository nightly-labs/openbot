import type { BrowserPreview, BrowserTakeoverRequest, RespondToBrowserSecretInput } from "@openbot/contracts/ipc";
import { Button, Input, Maximize2, Monitor } from "@openbot/ui";
import { OtpInput } from "@openbot/ui/features/account/OtpInput";
import { BrowserTakeoverPreview } from "@openbot/ui/features/conversation/BrowserTakeoverPreview";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";

export function BrowserSecretCard(props: {
  request: BrowserTakeoverRequest;
  onOpen?: () => void;
  loadPreview?: (tabId: string) => Promise<BrowserPreview>;
  onRespond: (input: RespondToBrowserSecretInput) => Promise<void>;
}) {
  const { t } = useText();
  const [preview, setPreview] = createSignal<BrowserPreview | null>(null);
  const [previewStatus, setPreviewStatus] = createSignal<"loading" | "ready" | "failed">("loading");
  const [previewHidden, setPreviewHidden] = createSignal(false);
  const [value, setValue] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const method = () => props.request.secret?.method;
  const digits = () => props.request.secret?.digits ?? 6;
  const password = () => method() === "password";
  const title = () =>
    password()
      ? t("browser.secret.title.password")
      : method() === "authenticator"
        ? t("browser.secret.title.authenticator")
        : t("browser.secret.title.code");
  // The origin is bold inside the sentence, so the sentence is split where the origin goes.
  const submitOnce = () => {
    const marker = "\u0000";
    const [before = "", after = ""] = t("browser.secret.submitOnce", { origin: marker }).split(marker);
    return { before, after };
  };
  const valid = () => (password() ? value().length > 0 : value().length === digits());
  onCleanup(() => setValue(""));
  createEffect(
    () => props.request.requestId,
    () => {
      setValue("");
      setError("");
      setPreview(null);
      setPreviewHidden(false);
      setPreviewStatus("loading");
      let active = true;
      onCleanup(() => {
        active = false;
      });
      if (!props.loadPreview) {
        setPreviewStatus("failed");
        return;
      }
      void props.loadPreview(props.request.tabId).then(
        (image) => {
          if (!active || previewHidden()) return;
          setPreview(image);
          setPreviewStatus("ready");
        },
        () => {
          if (active && !previewHidden()) setPreviewStatus("failed");
        },
      );
    },
  );
  const respond = async (decision: "submit" | "cancel" | "takeover") => {
    if (pending() || (decision === "submit" && !valid())) return;
    setPreviewHidden(true);
    setPreview(null);
    setPending(true);
    setError("");
    const identity = { requestId: props.request.requestId, agentId: props.request.agentId };
    const input: RespondToBrowserSecretInput =
      decision === "submit" ? { ...identity, decision, secret: value() } : { ...identity, decision };
    setValue("");
    try {
      await props.onRespond(input);
    } catch {
      setError(t("browser.secret.failed"));
    } finally {
      if (input.decision === "submit") input.secret = "";
      setPending(false);
    }
  };
  return (
    <form
      class="conversation-interaction-card browser-secret-card"
      aria-label={t("browser.secret.label")}
      aria-busy={pending() ? "true" : "false"}
      onSubmit={(event) => {
        event.preventDefault();
        void respond("submit");
      }}
    >
      <header class="conversation-interaction-header">
        <h2>{title()}</h2>
      </header>
      <p>
        {submitOnce().before}
        <strong>{props.request.secret?.origin}</strong>
        {submitOnce().after}
      </p>
      <p>
        {method() === "authenticator"
          ? t("browser.secret.hint.authenticator")
          : password()
            ? t("browser.secret.hint.password")
            : t("browser.secret.hint.code")}{" "}
        {t("browser.secret.notAddedToChat")}
      </p>
      <Show
        when={password()}
        fallback={
          <Show when={!pending()}>
            <div class="browser-secret-code">
              <span class="browser-secret-label">{t("browser.secret.codeLength", { digits: digits() })}</span>
              <OtpInput
                value={value()}
                length={digits()}
                numeric
                masked
                label={t("browser.secret.codeLength", { digits: digits() })}
                status={error() ? "error" : "idle"}
                errorMessage={error()}
                onChange={(next) => {
                  setValue(next);
                  setError("");
                }}
              />
            </div>
          </Show>
        }
      >
        <Show when={!pending()}>
          <label class="browser-secret-password">
            <span class="browser-secret-label">{t("browser.secret.password")}</span>
            <Input
              aria-label={t("browser.secret.password")}
              type="password"
              autocomplete="off"
              maxlength={4096}
              value={value()}
              disabled={pending()}
              invalid={Boolean(error())}
              onInput={(event) => {
                setValue(event.currentTarget.value);
                setError("");
              }}
            />
          </label>
        </Show>
        <Show when={error()}>
          <p class="browser-secret-error" role="alert">
            {error()}
          </p>
        </Show>
      </Show>
      <Show when={!previewHidden()}>
        <figure class="browser-takeover-preview">
          <figcaption class="browser-takeover-preview-bar">
            <Monitor aria-hidden="true" />
            <span>{t("browser.secret.signInPage")}</span>
            <small>{props.request.secret?.origin}</small>
          </figcaption>
          <Show
            when={props.onOpen}
            fallback={
              <div class="browser-takeover-preview-viewport">
                <BrowserTakeoverPreview
                  preview={preview()}
                  previewStatus={previewStatus()}
                  page={{ title: t("browser.secret.signInPage"), host: props.request.secret?.origin ?? "" }}
                />
              </div>
            }
          >
            <Button
              variant="ghost"
              type="button"
              class="browser-takeover-preview-viewport browser-takeover-preview-open"
              aria-label={t("browser.secret.openSignInPage")}
              onClick={() => props.onOpen?.()}
            >
              <BrowserTakeoverPreview
                preview={preview()}
                previewStatus={previewStatus()}
                page={{ title: t("browser.secret.signInPage"), host: props.request.secret?.origin ?? "" }}
              />
              <span class="browser-takeover-preview-open-label" aria-hidden="true">
                <Maximize2 />
                {t("browser.secret.openInBrowser")}
              </span>
            </Button>
          </Show>
        </figure>
      </Show>
      <footer class="browser-takeover-actions">
        <Button type="submit" disabled={pending() || !valid()}>
          {pending() ? t("browser.secret.submitting") : t("browser.secret.submit")}
        </Button>
        <Button type="button" variant="secondary" disabled={pending()} onClick={() => void respond("cancel")}>
          {t("common.cancel")}
        </Button>
        <Button type="button" variant="secondary" disabled={pending()} onClick={() => void respond("takeover")}>
          {t("browser.secret.takeOver")}
        </Button>
      </footer>
    </form>
  );
}
