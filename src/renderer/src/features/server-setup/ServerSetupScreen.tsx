import { AppLogo } from "@openbot/brand";
import type { AppVariant, CentralAuthIssue, CentralAuthState } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { AccountLogin } from "@openbot/ui/features/account/AccountLogin";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, onCleanup, onSettled, Show } from "solid-js";
import {
  NO_ANSWER,
  number,
  type SetupAnswer,
  setupLoginStart,
  setupLoginVerify,
  setupRetry,
  setupStatus,
  text,
} from "./server-setup-port";

const APP_URL = "https://openbot.run/app";
const PRODUCT_NAME = "OpenBot";
/** The name of a server before its first publish, as in `ServerMode`. */
const DEFAULT_SERVER_NAME = "OpenBot";
/** How often the page asks again while the account loads or the server starts. */
const STATUS_POLL_MS = 2_000;
/** How often the page asks again after an error. The server retries the account service by itself. */
const ERROR_POLL_MS = 10_000;

interface ServerView {
  email: string;
  online: boolean;
  name: string;
  message: string | null;
}

interface SetupState {
  login: CentralAuthState;
  /** The signed-in server, or null while the page shows the sign-in. */
  server: ServerView | null;
}

/**
 * The setup page of a server in a container (docs/umbrel.md): the sign-in screen of the app, then the
 * status of the server. The page has no sign-out: another account needs `openbot logout` in the
 * container.
 */
export function ServerSetupScreen() {
  const { t, sourceText } = useText();
  const variant: AppVariant = import.meta.env.DEV ? "dev" : "production";
  const [state, setState] = createStore<SetupState>({ login: { status: "loading" }, server: null });
  let pollTimer: number | undefined;

  onCleanup(() => window.clearTimeout(pollTimer));
  onSettled(() => void refresh());
  createEffect(
    () => t("server.setup.pageTitle"),
    (title) => {
      document.title = title;
    },
  );

  function fallbackMessage(code: string): string {
    switch (code) {
      case "invalid_email":
        return t("account.login.emailInvalid");
      case "company_sign_in_required":
        return t("server.setup.errorCompany");
      case NO_ANSWER:
        return t("server.setup.errorNoAnswer");
      default:
        return t("server.setup.errorRefused");
    }
  }

  function issueOf(answer: SetupAnswer): CentralAuthIssue {
    const code = text(answer, "error") ?? "failed";
    const message = text(answer, "message") ?? fallbackMessage(code);
    const retryAfterSeconds = number(answer, "retry_after");
    return retryAfterSeconds ? { code, message, retryAfterSeconds } : { code, message };
  }

  /** The server refused because of its account state: the page shows that state. */
  function refusedByAccount(answer: SetupAnswer): boolean {
    const code = text(answer, "error");
    return code === "signed_in" || (code?.startsWith("account_") ?? false);
  }

  function poll(delay = STATUS_POLL_MS): void {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(() => void refresh(), delay);
  }

  function showStatus(answer: SetupAnswer): void {
    window.clearTimeout(pollTimer);
    if (!answer.ok) {
      // The screen of an unreachable service, with its retry button.
      const issue = { code: "auth_api_unavailable", message: fallbackMessage(text(answer, "error") ?? NO_ANSWER) };
      setState((draft) => {
        draft.server = null;
        draft.login = { status: "error", issue };
      });
      poll(ERROR_POLL_MS);
      return;
    }
    const account = text(answer, "account");
    if (account === "signed_in") {
      const server: ServerView = {
        email: text(answer, "email") ?? "",
        online: text(answer, "server") === "online",
        name: text(answer, "server_name") ?? DEFAULT_SERVER_NAME,
        message: text(answer, "server_message"),
      };
      setState((draft) => {
        draft.server = server;
      });
      if (!server.online) poll();
      return;
    }
    const issue: CentralAuthIssue | null =
      account === "error"
        ? {
            code: text(answer, "account_issue") ?? "auth_api_unavailable",
            message: text(answer, "account_message") ?? t("account.login.unavailableDescription"),
          }
        : null;
    const loading = account === "loading" || account === "signing_in";
    const keepChallenge = !issue && !loading && state.login.status === "code_sent";
    setState((draft) => {
      draft.server = null;
      if (issue) draft.login = { status: "error", issue };
      else if (loading) draft.login = { status: "loading" };
      // A code that another page asked for stays with that page: this one starts at the email.
      else if (!keepChallenge) draft.login = { status: "signed_out" };
    });
    if (loading) poll();
    else if (issue) poll(ERROR_POLL_MS);
  }

  async function refresh(): Promise<void> {
    showStatus(await setupStatus());
  }

  async function requestEmailCode(email: string): Promise<void> {
    const answer = await setupLoginStart(email);
    const challengeId = text(answer, "challenge");
    if (answer.ok && challengeId) {
      const login: CentralAuthState = {
        status: "code_sent",
        challengeId,
        email,
        expiresAt: number(answer, "expires_at") ?? 0,
        resendAvailableAt: number(answer, "resend_at") ?? 0,
      };
      setState((draft) => {
        draft.login = login;
      });
      return;
    }
    if (refusedByAccount(answer)) {
      await refresh();
      return;
    }
    const issue = issueOf(answer);
    const current = state.login;
    const login: CentralAuthState = current.status === "code_sent" ? { ...current, issue } : { status: "error", issue };
    setState((draft) => {
      draft.login = login;
    });
  }

  async function verifyEmailCode(_challengeId: string, code: string): Promise<void> {
    const current = state.login;
    if (current.status !== "code_sent") return;
    const answer = await setupLoginVerify(current.challengeId, code);
    if (answer.ok) {
      showStatus(answer);
      return;
    }
    if (refusedByAccount(answer)) {
      await refresh();
      return;
    }
    const issue = issueOf(answer);
    setState((draft) => {
      draft.login = { ...current, issue };
    });
  }

  return (
    <Show
      when={state.server}
      fallback={
        <AccountLogin
          variant={variant}
          state={state.login}
          onRetry={async () => showStatus(await setupRetry())}
          onRequestEmailCode={requestEmailCode}
          onVerifyEmailCode={verifyEmailCode}
          onReset={async () => {
            setState((draft) => {
              draft.login = { status: "signed_out" };
            });
          }}
        />
      }
    >
      {(server) => (
        <main class="account-login-screen">
          <div class="account-login-shell">
            <header class="account-login-brand-lockup">
              <AppLogo variant={variant} animation="blink" interactive class="account-login-logo" />
              <span class="account-login-wordmark">{PRODUCT_NAME}</span>
            </header>
            <section class="account-login" aria-labelledby="server-setup-title" aria-live="polite">
              <h1 id="server-setup-title" class="account-login-title">
                {server().online
                  ? t("server.setup.online", { name: server().name })
                  : t("server.setup.starting", { name: server().name })}
              </h1>
              <p class="account-login-description">{t("server.setup.signedInAs", { email: server().email })}</p>
              <Show when={!server().online}>
                <div class="account-login-loader" role="status">
                  <span class="account-login-spinner" aria-hidden="true" />
                  <Show when={server().message}>
                    {(message) => <span class="account-login-error">{sourceText(message())}</span>}
                  </Show>
                </div>
              </Show>
              <Button
                as="a"
                variant="default"
                class="account-login-primary"
                href={APP_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("server.setup.openApp")}
              </Button>
              <div class="account-login-footer">
                <p class="account-login-local-data">{t("server.setup.signOutDescription")}</p>
              </div>
            </section>
          </div>
        </main>
      )}
    </Show>
  );
}
