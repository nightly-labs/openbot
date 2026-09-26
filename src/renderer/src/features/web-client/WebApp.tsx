import { agentTemplateIdFromWebAppSearch, WEB_APP_AGENT_TEMPLATE_PARAM } from "@openbot/contracts/agent-template-links";
import type { CentralAuthState, CentralAuthUser } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Toaster } from "@openbot/ui";
import { AccountLogin } from "@openbot/ui/features/account/AccountLogin";
import { createSignal, createStore, onSettled, Show } from "solid-js";
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

export function WebApp(props: { createRuntime?: WebRuntimeFactory } = {}) {
  const [state, setState] = createStore<{
    account: CentralAuthUser | null;
    loaded: boolean;
    login: CentralAuthState;
    resendAt: number;
    busy: boolean;
    error: string | null;
  }>({
    account: null,
    loaded: false,
    login: { status: "signed_out" },
    resendAt: 0,
    busy: false,
    error: null,
  });
  // Kept here, not in the workspace, so the link waits through sign-in.
  const [agentTemplateId, setAgentTemplateId] = createSignal(takeAgentTemplateLink());
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
              : "Sign-in failed.",
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
          : "The account request failed.",
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
          draft.error = null;
        });
      }
    } catch (error) {
      if (!disposed && generation === sessionGeneration)
        setState((draft) => {
          draft.error = error instanceof Error ? error.message : "Could not check this session.";
        });
    } finally {
      if (!disposed)
        setState((draft) => {
          draft.loaded = true;
        });
    }
  }
  async function action(work: () => Promise<void>) {
    if (state.busy) return;
    setState((draft) => {
      draft.busy = true;
      draft.error = null;
    });
    try {
      await work();
    } catch (error) {
      setState((draft) => {
        draft.error = error instanceof Error ? error.message : "Sign-in failed.";
      });
    } finally {
      setState((draft) => {
        draft.busy = false;
      });
    }
  }
  async function start(email: string) {
    if (Date.now() < state.resendAt) throw new Error("Wait before requesting another code.");
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
      draft.error = null;
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
  return (
    <div class="web-app">
      <Toaster />
      <Show when={state.loaded} fallback={<p role="status">Loading OpenBot…</p>}>
        <Show
          keyed
          when={state.account?.id}
          fallback={
            <AccountLogin
              variant="production"
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
            <>
              <Show when={state.error}>
                <p role="alert">{state.error}</p>
              </Show>
              <WebWorkspace
                accountId={accountId}
                accountEmail={state.account?.email ?? ""}
                accountName={state.account?.name ?? null}
                accountAvatarUrl={state.account?.avatarUrl ?? null}
                accountFetch={accountFetch}
                onSessionCheck={checkSession}
                accountSessionEnded={() => sessionEnded}
                onLogout={() => action(logout)}
                createRuntime={props.createRuntime}
                agentTemplateId={agentTemplateId()}
                onAgentTemplateClose={() => setAgentTemplateId(null)}
              />
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
