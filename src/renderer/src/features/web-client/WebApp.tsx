import { agentTemplateIdFromWebAppSearch, WEB_APP_AGENT_TEMPLATE_PARAM } from "@openbot/contracts/agent-template-links";
import { inviteUrlFromWebAppSearch, WEB_APP_INVITE_FIELDS } from "@openbot/contracts/invite-links";
import type { AppVariant, CentralAuthState, CentralAuthUser } from "@openbot/contracts/ipc";
import { pluginSlugFromWebAppSearch, WEB_APP_PLUGIN_PARAM } from "@openbot/contracts/plugin-links";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { formatLocale, resolveLocale } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { Toaster, toast } from "@openbot/ui";
import { AccountLogin } from "@openbot/ui/features/account/AccountLogin";
import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import { currentText } from "@openbot/ui/text";
import { createSignal, createStore, onSettled, Show } from "solid-js";
// Copying a selection with a formula in it gives its LaTeX source, as on desktop.
import "katex/contrib/copy-tex";
import { StaticI18nProvider } from "../../i18n-context";
import { WebWorkspace } from "./WebWorkspace";
import type { WebRuntimeFactory } from "./web-client-context";

/** A sign-in refusal that the login form already shows. */
class SignInIssueShown extends Error {}

/**
 * The shared agent a `/app?agent=<id>` link names. The query is removed after it is read, so a reload
 * does not open the preview again.
 */
function takeAgentTemplateLink(): string | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(WEB_APP_AGENT_TEMPLATE_PARAM)) return null;
  const id = agentTemplateIdFromWebAppSearch(url.search);
  url.searchParams.delete(WEB_APP_AGENT_TEMPLATE_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return id;
}

/**
 * The invitation a `/app?api=…&server=…&fingerprint=…&invite=…` link names, as the `/join` page
 * passes it on. The fields are removed after they are read, so the secret does not stay in the
 * address bar or the history, and a reload does not open the dialog again.
 */
function takeInviteLink(): string | null {
  const url = new URL(window.location.href);
  if (!WEB_APP_INVITE_FIELDS.some((field) => url.searchParams.has(field))) return null;
  const inviteUrl = inviteUrlFromWebAppSearch(url.search, { allowLocalDevelopmentApiUrl: import.meta.env.DEV });
  for (const field of WEB_APP_INVITE_FIELDS) url.searchParams.delete(field);
  window.history.replaceState(window.history.state, "", url);
  return inviteUrl;
}

/** The plugin listing a `/app?plugin=<slug>` link names. The query is removed after it is read. */
function takePluginLink(): string | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(WEB_APP_PLUGIN_PARAM)) return null;
  const slug = pluginSlugFromWebAppSearch(url.search);
  url.searchParams.delete(WEB_APP_PLUGIN_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return slug;
}

export function WebApp(props: { createRuntime?: WebRuntimeFactory } = {}) {
  // This component renders the text provider, so it reads the text of the last provider that rendered.
  const text = currentText();
  const [state, setState] = createStore<{
    account: CentralAuthUser | null;
    loaded: boolean;
    login: CentralAuthState;
    resendAt: number;
  }>({
    account: null,
    loaded: false,
    login: { status: "signed_out" },
    resendAt: 0,
  });
  // Kept here, not in the workspace, so each link waits through sign-in.
  const [agentTemplateId, setAgentTemplateId] = createSignal(takeAgentTemplateLink());
  const [inviteUrl, setInviteUrl] = createSignal(takeInviteLink());
  const [pluginSlug, setPluginSlug] = createSignal(takePluginLink());
  let channel: BroadcastChannel | null = null;
  let disposed = false;
  let sessionGeneration = 0;
  /**
   * The cookie's account session has ended. The server ended its remote sessions in the same write
   * (`endAccountSession`), so the closing workspace does not end them again.
   */
  let sessionEnded = false;
  function clearSession(ended = true) {
    sessionEnded = ended;
    sessionGeneration += 1;
    setState((draft) => {
      draft.account = null;
      draft.login = { status: "signed_out" };
    });
  }
  const accountFetch: typeof fetch = async (input, init) => {
    const generation = sessionGeneration;
    const response = await fetch(input, init);
    if (
      !disposed &&
      generation === sessionGeneration &&
      response.status === 401 &&
      input !== "/api/browser/email/start" &&
      input !== "/api/browser/email/verify"
    ) {
      if (state.account) channel?.postMessage("session-changed");
      clearSession();
    }
    return response;
  };
  async function request(
    path: string,
    body?: { email: string } | { challengeId: string | null; code: string } | Record<string, never>,
  ) {
    const response = await accountFetch(`/api/browser/${path}`, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json", "X-OpenBot-Browser": "1" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) {
      if (path === "email/start" || path === "email/verify") {
        const retryAfterSeconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
        const issue = {
          code:
            isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.code)
              ? value.error.code
              : "sign_in_failed",
          message:
            isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message)
              ? value.error.message
              : text.t("webClient.login.failed"),
          ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        };
        setState((draft) => {
          draft.login = draft.login.status === "code_sent" ? { ...draft.login, issue } : { status: "error", issue };
        });
        throw new SignInIssueShown();
      }
      throw new Error(
        isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message)
          ? value.error.message
          : text.t("webClient.login.requestFailed"),
      );
    }
    return value;
  }
  /** Like the desktop login, a server refusal is shown as the login issue, not also as a thrown error. */
  async function signInRequest(path: "email/start" | "email/verify", body: Parameters<typeof request>[1]) {
    try {
      return await request(path, body);
    } catch (error) {
      if (error instanceof SignInIssueShown) return null;
      throw error;
    }
  }
  function accountFrom(value: unknown): CentralAuthUser {
    if (
      !isDynamicRecord(value) ||
      !isDynamicRecord(value.user) ||
      !isString(value.user.id) ||
      !isString(value.user.email)
    )
      throw new Error("The account response is invalid.");
    return {
      id: value.user.id,
      email: value.user.email,
      name: isString(value.user.name) ? value.user.name : null,
      avatarUrl: isString(value.user.avatarUrl) ? value.user.avatarUrl : null,
    };
  }
  async function checkSession() {
    const generation = sessionGeneration;
    try {
      const account = accountFrom(await request("session"));
      if (!disposed && generation === sessionGeneration) {
        sessionEnded = false;
        setState((draft) => {
          draft.account = account;
        });
      }
    } catch (error) {
      if (!disposed && generation === sessionGeneration) {
        // Signed in, the workspace stays usable. Signed out, the login screen offers a retry, as on desktop.
        if (state.account)
          toast.error(
            text.sourceText(error instanceof Error ? error.message : text.t("webClient.login.sessionFailed")),
          );
        else
          setState((draft) => {
            draft.login = {
              status: "error",
              issue: { code: "auth_api_unavailable", message: sourceText("error.auth.serviceUnavailable") },
            };
          });
      }
    } finally {
      if (!disposed)
        setState((draft) => {
          draft.loaded = true;
        });
    }
  }
  async function start(email: string) {
    if (Date.now() < state.resendAt) throw new Error(text.t("webClient.login.wait"));
    const value = await signInRequest("email/start", { email });
    if (value === null) return;
    if (!isDynamicRecord(value) || !isString(value.challengeId) || typeof value.resendAt !== "number")
      throw new Error("The sign-in response is invalid.");
    const challengeId = value.challengeId;
    const resendAt = value.resendAt;
    setState((draft) => {
      draft.resendAt = resendAt;
      draft.login = {
        status: "code_sent",
        challengeId,
        email,
        expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : Date.now() + 600000,
        resendAvailableAt: resendAt,
        ...(isString(value.developmentCode) ? { developmentCode: value.developmentCode } : {}),
      };
    });
  }
  async function verify(challengeId: string, code: string) {
    const value = await signInRequest("email/verify", { challengeId, code });
    if (value === null) return;
    const account = accountFrom(value);
    sessionGeneration += 1;
    sessionEnded = false;
    channel?.postMessage("session-changed");
    setState((draft) => {
      draft.account = account;
    });
  }
  async function logout() {
    await request("logout", {});
    clearSession();
    channel?.postMessage("session-changed");
  }
  onSettled(() => {
    channel = new BroadcastChannel("openbot.web.session");
    channel.onmessage = () => {
      clearSession();
      void checkSession();
    };
    void checkSession();
    // A page restored from the back-forward cache still has its session; its connection ends normally.
    const restore = () => {
      clearSession(false);
      void checkSession();
    };
    window.addEventListener("pageshow", restore);
    return () => {
      disposed = true;
      channel?.close();
      window.removeEventListener("pageshow", restore);
    };
  });
  const variant: AppVariant = import.meta.env.DEV ? "dev" : "production";
  // The web client has no saved language setting, so it follows the browser.
  return (
    <StaticI18nProvider
      locale={resolveLocale("system", navigator.language)}
      formatLocale={formatLocale("system", navigator.language)}
    >
      <div class="web-app">
        <Toaster />
        <Show when={state.loaded} fallback={<AppLoadingScreen variant={variant} />}>
          <Show
            keyed
            when={state.account?.id}
            fallback={
              <AccountLogin
                variant={variant}
                state={state.login}
                onRetry={checkSession}
                onRequestEmailCode={start}
                onVerifyEmailCode={verify}
                onReset={async () => {
                  clearSession();
                  setState((draft) => {
                    draft.resendAt = 0;
                  });
                }}
              />
            }
          >
            {(accountId) => (
              <WebWorkspace
                accountId={accountId}
                accountEmail={state.account?.email ?? ""}
                accountName={state.account?.name ?? null}
                accountAvatarUrl={state.account?.avatarUrl ?? null}
                accountFetch={accountFetch}
                onSessionCheck={checkSession}
                accountSessionEnded={() => sessionEnded}
                onLogout={logout}
                createRuntime={props.createRuntime}
                agentTemplateId={agentTemplateId()}
                onAgentTemplateClose={() => setAgentTemplateId(null)}
                inviteUrl={inviteUrl()}
                onInviteClose={() => setInviteUrl(null)}
                pluginSlug={pluginSlug()}
                onPluginSlugConsumed={() => setPluginSlug(null)}
              />
            )}
          </Show>
        </Show>
      </div>
    </StaticI18nProvider>
  );
}
