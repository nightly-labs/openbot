import { AppLogo } from "@openbot/brand";
import type { AppVariant } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";
import {
  type ExtensionConnectRequest,
  extensionAllowedBy,
  extensionReturnUrl,
  forgetExtensionConnect,
  rememberExtensionAllowed,
} from "./web-extension-connect";

const PRODUCT_NAME = "OpenBot";

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
        const refusal =
          isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message)
            ? sourceText(value.error.message)
            : t("webClient.extension.failed");
        setError(refusal);
        setPending(false);
        return;
      }
      forgetExtensionConnect();
      rememberExtensionAllowed(props.request.extensionId, props.accountId);
      window.location.assign(extensionReturnUrl(props.request, { code: value.code }));
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
          <div class="account-login-form">
            <Show when={error()}>
              {(text) => (
                <p class="account-login-error" role="alert">
                  {text()}
                </p>
              )}
            </Show>
            <Button
              variant="default"
              type="button"
              class="account-login-primary"
              disabled={pending()}
              onClick={() => void allow()}
            >
              {t("webClient.extension.allow")}
            </Button>
            <Button variant="ghost" type="button" disabled={pending()} onClick={cancel}>
              {t("common.cancel")}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
