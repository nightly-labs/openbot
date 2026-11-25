import { AppLogo } from "@openbot/brand";
import type { AppVariant } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";
import {
  answerExtensionTab,
  type ExtensionConnectRequest,
  extensionAllowedBy,
  extensionReturnUrl,
  forgetExtensionConnect,
  rememberExtensionAllowed,
} from "./web-extension-connect";

const PRODUCT_NAME = "OpenBot";
const EXTENSION_NOT_LISTED = "browser_extension_not_allowed";

interface WebExtensionConnectProps {
  variant: AppVariant;
  request: ExtensionConnectRequest;
  accountId: string;
  email: string;
  accountFetch: typeof fetch;
}

export function WebExtensionConnect(props: WebExtensionConnectProps) {
  const { t, sourceText } = useText();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [done, setDone] = createSignal(false);
  const [extensionNotListed, setExtensionNotListed] = createSignal(false);

  async function allow() {
    setPending(true);
    setError(null);
    try {
      const response = await props.accountFetch("/api/browser/extension/code", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-OpenBot-Browser": "1" },
        body: JSON.stringify({ extensionId: props.request.extensionId, clientChallenge: props.request.challenge }),
      });
      const value = await response.json().catch(() => null);
      if (!response.ok || !isDynamicRecord(value) || !isString(value.code)) {
        const failure = isDynamicRecord(value) && isDynamicRecord(value.error) ? value.error : null;
        setError(failure && isString(failure.message) ? sourceText(failure.message) : t("webClient.extension.failed"));
        setExtensionNotListed(failure?.code === EXTENSION_NOT_LISTED);
        setPending(false);
        return;
      }
      forgetExtensionConnect();
      rememberExtensionAllowed(props.request.extensionId, props.accountId);
      if (!props.request.tab) {
        window.location.assign(extensionReturnUrl(props.request, { code: value.code }));
        return;
      }
      if (await answerExtensionTab(props.request, { code: value.code })) setDone(true);
      else {
        setError(t("webClient.extension.failed"));
        setPending(false);
      }
    } catch {
      setError(t("webClient.extension.failed"));
      setPending(false);
    }
  }

  onSettled(() => {
    if (!props.request.silent) return;
    if (extensionAllowedBy(props.request.extensionId, props.accountId)) void allow();
    else {
      forgetExtensionConnect();
      window.location.assign(extensionReturnUrl(props.request, { error: "consent_required" }));
    }
  });

  function cancel() {
    forgetExtensionConnect();
    if (props.request.tab) {
      setPending(true);
      void answerExtensionTab(props.request, { error: "access_denied" }).then(() => {
        setPending(false);
        setDone(true);
      });
      return;
    }
    window.location.assign(extensionReturnUrl(props.request, { error: "access_denied" }));
  }

  return (
    <main class="account-login-screen">
      <div class="account-login-shell">
        <header class="account-login-brand-lockup">
          <AppLogo variant={props.variant} animation="blink" interactive class="account-login-logo" />
          <span class="account-login-wordmark">{PRODUCT_NAME}</span>
        </header>
        <section
          class="account-login"
          aria-labelledby="extension-connect-title"
          aria-describedby="extension-connect-description"
        >
          <h1 id="extension-connect-title" class="account-login-title">
            {t("webClient.extension.title")}
          </h1>
          <p id="extension-connect-description" class="account-login-description">
            {t("webClient.extension.description", { email: props.email })}
          </p>
          <Show
            when={!done()}
            fallback={
              <p class="account-login-description" role="status">
                {t("webClient.extension.done")}
              </p>
            }
          >
            <div class="account-login-form">
              <Show when={error()}>
                {(text) => (
                  <p class="account-login-error" role="alert">
                    {text()}
                  </p>
                )}
              </Show>
              <Show when={!extensionNotListed()}>
                <Button
                  variant="default"
                  type="button"
                  class="account-login-primary"
                  disabled={pending()}
                  onClick={() => void allow()}
                >
                  {t("webClient.extension.allow")}
                </Button>
              </Show>
              <Button variant="ghost" type="button" disabled={pending()} onClick={cancel}>
                {t("common.cancel")}
              </Button>
            </div>
          </Show>
        </section>
      </div>
    </main>
  );
}
