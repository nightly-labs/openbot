import { AppLogo } from "@openbot/brand";
import type { CentralAuthState } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { AccountLogin } from "@openbot/ui/features/account/AccountLogin";
import { useText } from "@openbot/ui/text";
import { createSignal, Show } from "solid-js";
import { SignInIssue, signInWithWeb } from "./account";
import type { ExtensionSession } from "./extension-storage";

/** The brand name, as the sign-in screen shows it; it is not translated. */
const PRODUCT_NAME = "OpenBot";

interface SignInScreenProps {
  login: CentralAuthState;
  onRetry: () => Promise<void>;
  onRequestEmailCode: (email: string) => Promise<void>;
  onVerifyEmailCode: (challengeId: string, code: string, referralCode?: string) => Promise<void>;
  onReset: () => Promise<void>;
  onSignedIn: (session: ExtensionSession) => Promise<void>;
}

const variant = import.meta.env.DEV ? "dev" : "production";

/**
 * Sign-in through openbot.run first: a person who is signed in there only allows the extension, and
 * company sign-in works as on the web. The email code of the phone app stays as the other way.
 */
export function SignInScreen(props: SignInScreenProps) {
  const { t, sourceText } = useText();
  const [withCode, setWithCode] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [issue, setIssue] = createSignal<string | null>(null);

  async function signIn() {
    setPending(true);
    setIssue(null);
    try {
      await props.onSignedIn(await signInWithWeb());
    } catch (error) {
      setIssue(
        error instanceof SignInIssue
          ? sourceText(error.issue.message)
          : error instanceof Error
            ? error.message
            : t("extension.signIn.failed"),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Show
      when={!withCode() && props.login.status !== "loading"}
      fallback={
        <AccountLogin
          variant={variant}
          state={props.login}
          onRetry={props.onRetry}
          onRequestEmailCode={props.onRequestEmailCode}
          onVerifyEmailCode={props.onVerifyEmailCode}
          onReset={props.onReset}
          inviteField
        />
      }
    >
      <main class="account-login-screen">
        <div class="account-login-shell">
          <header class="account-login-brand-lockup">
            <AppLogo variant={variant} animation="blink" interactive class="account-login-logo" />
            <span class="account-login-wordmark">{PRODUCT_NAME}</span>
          </header>
          <section
            class="account-login"
            aria-labelledby="extension-sign-in-title"
            aria-describedby="extension-sign-in-description"
          >
            <h1 id="extension-sign-in-title" class="account-login-title">
              {t("extension.signIn.title")}
            </h1>
            <p id="extension-sign-in-description" class="account-login-description">
              {pending() ? t("extension.signIn.waiting") : t("extension.signIn.description")}
            </p>
            <div class="account-login-form">
              <Show when={issue()}>
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
                onClick={() => void signIn()}
              >
                {t("extension.signIn.withWeb")}
              </Button>
              <Button variant="ghost" type="button" disabled={pending()} onClick={() => setWithCode(true)}>
                {t("extension.signIn.withCode")}
              </Button>
            </div>
          </section>
        </div>
      </main>
    </Show>
  );
}
