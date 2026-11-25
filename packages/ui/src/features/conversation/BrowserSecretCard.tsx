import type {
  BrowserPreview,
  BrowserTakeoverRequest,
  BrowserVaultSkipReason,
  LocalBrowserSecretResponse,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Checkbox, ErrorReference, Input, Lock, Maximize2, Monitor, ShieldCheck, X } from "@openbot/ui";
import { OtpInput } from "@openbot/ui/features/account/OtpInput";
import { BrowserTakeoverPreview } from "@openbot/ui/features/conversation/BrowserTakeoverPreview";
import { useText } from "@openbot/ui/text";
import { errorReference } from "@openbot/user-errors";
import { createEffect, createMemo, createSignal, createUniqueId, onCleanup, Show } from "solid-js";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

const VAULT_SKIP_TEXT = {
  "agent-script": "browser.secret.vaultSkip.agentScript",
  "field-kind": "browser.secret.vaultSkip.fieldKind",
  "login-choice": "browser.secret.vaultSkip.loginChoice",
  "no-secret": "browser.secret.vaultSkip.noPassword",
  "vault-unreadable": "browser.secret.vaultSkip.vaultUnreadable",
} as const satisfies Record<BrowserVaultSkipReason, AppTextKey>;

export interface BrowserSecretVault {
  server: string | null;
  blocked?: "role" | "version" | undefined;
}

export function BrowserSecretCard(props: {
  request: BrowserTakeoverRequest;
  variant?: "card" | "island";
  onOpen?: (() => void) | undefined;
  loadPreview?: ((tabId: string) => Promise<BrowserPreview>) | undefined;
  vault?: BrowserSecretVault | undefined;
  onRespond: (input: LocalBrowserSecretResponse) => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const saveId = `browser-secret-save-${createUniqueId()}`;
  const formId = createUniqueId();
  const [saveChoice, setSaveChoice] = createSignal<boolean | null>(null);
  const saveBlocked = () => Boolean(props.vault?.blocked);
  const saveToVault = () => !saveBlocked() && (saveChoice() ?? true);
  const [preview, setPreview] = createSignal<BrowserPreview | null>(null);
  const [previewStatus, setPreviewStatus] = createSignal<"loading" | "ready" | "failed">("loading");
  const [previewHidden, setPreviewHidden] = createSignal(false);
  const [value, setValue] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [failureCode, setFailureCode] = createSignal<string | null>(null);
  const shownCode = () => (error() ? failureCode() : null);
  const variant = () => props.variant ?? "card";
  const method = () => props.request.secret?.method;
  const digits = () => props.request.secret?.digits ?? 6;
  const password = () => method() === "password";
  const title = () =>
    password()
      ? t("browser.secret.title.password")
      : method() === "authenticator"
        ? t("browser.secret.title.authenticator")
        : t("browser.secret.title.code");
  const submitOnce = () => {
    const marker = "\u0000";
    const [before = "", after = ""] = t("browser.secret.submitOnce", { origin: marker }).split(marker);
    return { before, after };
  };
  const remoteSaveLabel = createMemo(() => {
    const server = props.vault?.server;
    if (!server) return null;
    const marker = "\u0000";
    const [before = "", after = ""] = t("browser.secret.saveToVaultOn", { server: marker }).split(marker);
    return { before, server, after };
  });
  const saveHint = (vault: BrowserSecretVault) => {
    if (vault.server === null) return t("browser.secret.saveHintLocal");
    if (vault.blocked === "role") return t("browser.secret.saveBlockedRole", { server: vault.server });
    if (vault.blocked === "version") return t("browser.secret.saveBlockedVersion", { server: vault.server });
    return t("browser.secret.saveHintRemote", { server: vault.server });
  };
  const vaultSkipText = () => {
    const reason = props.request.vaultSkip;
    if (!reason) return null;
    if (reason === "no-secret" && !password()) return t("browser.secret.vaultSkip.noAuthenticatorKey");
    return t(VAULT_SKIP_TEXT[reason]);
  };
  const vaultSkipNote = () => (
    <Show when={vaultSkipText()}>{(text) => <p class="browser-secret-vault-skip">{text()}</p>}</Show>
  );
  const valid = () => (password() ? value().length > 0 : value().length === digits());
  onCleanup(() => setValue(""));
  const requestId = createMemo(() => props.request.requestId);
  const showsPreview = createMemo(() => variant() === "card");
  createEffect(
    () => ({ requestId: requestId(), showPreview: showsPreview() }),
    ({ showPreview }) => {
      setValue("");
      setError("");
      setPreview(null);
      setPreviewHidden(false);
      setPreviewStatus("loading");
      if (!showPreview) return;
      if (!props.loadPreview) {
        setPreviewStatus("failed");
        return;
      }
      let active = true;
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
      return () => {
        active = false;
      };
    },
  );
  const respond = async (decision: LocalBrowserSecretResponse["decision"]) => {
    if (pending() || (decision === "submit" && !valid())) return;
    setPreviewHidden(true);
    setPreview(null);
    setPending(true);
    setError("");
    const identity = { requestId: props.request.requestId, agentId: props.request.agentId };
    const save: { saveToVault?: true } = props.vault && password() && saveToVault() ? { saveToVault: true } : {};
    const input: LocalBrowserSecretResponse =
      decision === "submit" ? { ...identity, decision, secret: value(), ...save } : { ...identity, decision };
    setValue("");
    try {
      await props.onRespond(input);
    } catch (cause) {
      const ended = errorMessage(cause, t("browser.secret.failed")) === t("error.backend.authRequestInactive");
      setFailureCode(ended ? null : errorReference(cause));
      setError(ended ? t("browser.secret.ended") : t("browser.secret.failed"));
    } finally {
      if (input.decision === "submit") input.secret = "";
      setPending(false);
    }
  };
  const previewPage = () => ({ title: t("browser.secret.signInPage"), host: props.request.secret?.origin ?? "" });
  const submitOnceText = () => (
    <>
      {submitOnce().before}
      <strong class="browser-secret-origin">{props.request.secret?.origin}</strong>
      {submitOnce().after}
    </>
  );
  const valueField = () => (
    <Show
      when={password()}
      fallback={
        <div class="browser-secret-code">
          <OtpInput
            value={value()}
            length={digits()}
            numeric
            masked
            size="compact"
            label={t("browser.secret.codeLength", { digits: digits() })}
            status={error() ? "error" : pending() ? "verifying" : "idle"}
            errorMessage={error()}
            onChange={(next) => {
              setValue(next);
              setError("");
            }}
          />
          <ErrorReference reference={shownCode()} />
        </div>
      }
    >
      <div class="browser-secret-password">
        <Input
          aria-label={t("browser.secret.password")}
          placeholder={t("browser.secret.password")}
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
        <Show when={error()}>
          <p class="browser-secret-error" role="alert">
            {error()}
            <ErrorReference reference={shownCode()} />
          </p>
        </Show>
        <Show when={props.vault}>
          {(vault) => (
            <div class="browser-secret-save-option">
              <label class="browser-secret-save" for={saveId}>
                <Checkbox
                  id={saveId}
                  checked={saveToVault()}
                  disabled={pending() || saveBlocked()}
                  aria-describedby={`${saveId}-hint`}
                  onChange={(event) => setSaveChoice(event.currentTarget.checked)}
                />
                <Show when={remoteSaveLabel()} fallback={<span>{t("browser.secret.saveToVaultLocal")}</span>}>
                  {(label) => (
                    <span>
                      {label().before}
                      <strong class="browser-secret-save-server">{label().server}</strong>
                      {label().after}
                    </span>
                  )}
                </Show>
              </label>
              <p class="browser-secret-save-hint" id={`${saveId}-hint`}>
                {saveHint(vault())}
              </p>
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
  const privateNote = () => (
    <span class="browser-secret-private">
      <ShieldCheck class="browser-secret-glyph-sm" aria-hidden="true" />
      {t("browser.secret.notAddedToChat")}
    </span>
  );
  const noteUnlessSending = () => (pending() ? undefined : privateNote());
  const takeOverButton = () => (
    <Button
      variant={takeOverVariant()}
      size="sm"
      type="button"
      disabled={pending()}
      onClick={() => void respond("takeover")}
    >
      {t("browser.secret.takeOver")}
    </Button>
  );
  const takeOverVariant = () => (variant() === "card" ? "secondary" : "ghost");
  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void respond("submit");
  };
  return (
    <Show when={variant() === "card"} fallback={<IslandFrame />}>
      <UiBlockCard
        class="browser-secret-card"
        status="pending"
        title={title()}
        subtitle={submitOnceText()}
        icon={
          <span class="ui-block-icon integration-logo-tile" aria-hidden="true">
            <Lock />
          </span>
        }
        busy={pending()}
        waiting
        footerStart={noteUnlessSending()}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={pending()}
              onClick={() => void respond("cancel")}
            >
              {t("common.cancel")}
            </Button>
            {takeOverButton()}
            <Button size="sm" type="submit" form={formId} disabled={!valid() || pending()}>
              {t("browser.secret.submit")}
            </Button>
          </>
        }
      >
        <form id={formId} class="browser-secret-fields" aria-label={t("browser.secret.label")} onSubmit={onSubmit}>
          {vaultSkipNote()}
          {valueField()}
        </form>
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
                  <BrowserTakeoverPreview preview={preview()} previewStatus={previewStatus()} page={previewPage()} />
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
                <BrowserTakeoverPreview preview={preview()} previewStatus={previewStatus()} page={previewPage()} />
                <span class="browser-takeover-preview-open-label" aria-hidden="true">
                  <Maximize2 />
                  {t("browser.secret.openInBrowser")}
                </span>
              </Button>
            </Show>
          </figure>
        </Show>
      </UiBlockCard>
    </Show>
  );

  function IslandFrame() {
    return (
      <form
        class="browser-secret-card"
        data-variant="island"
        aria-label={t("browser.secret.label")}
        aria-busy={pending() ? "true" : "false"}
        onSubmit={onSubmit}
      >
        <header class="browser-secret-header">
          <span class="browser-secret-icon" aria-hidden="true">
            <Lock class="browser-secret-glyph" />
          </span>
          <div class="browser-secret-heading">
            <h2>{title()}</h2>
            <p>{submitOnceText()}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            class="browser-secret-close"
            aria-label={t("common.cancel")}
            disabled={pending()}
            onClick={() => void respond("cancel")}
          >
            <X aria-hidden="true" />
          </Button>
        </header>
        {vaultSkipNote()}
        {valueField()}
        <footer class="browser-secret-footer">
          {privateNote()}
          {takeOverButton()}
          <Button
            size="sm"
            type="submit"
            disabled={!valid()}
            loading={pending()}
            loadingLabel={t("browser.secret.submitting")}
          >
            {t("browser.secret.submit")}
          </Button>
        </footer>
      </form>
    );
  }
}
