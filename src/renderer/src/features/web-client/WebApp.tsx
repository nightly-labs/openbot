import { agentTemplateIdFromWebAppSearch, WEB_APP_AGENT_TEMPLATE_PARAM } from "@openbot/contracts/agent-template-links";
import { companySignInErrorKey, WEB_APP_COMPANY_SIGN_IN_ERROR_PARAM } from "@openbot/contracts/company-sign-in";
import { type FirstTouch, readFirstTouch } from "@openbot/contracts/first-touch";
import { inviteUrlFromWebAppSearch, WEB_APP_INVITE_FIELDS } from "@openbot/contracts/invite-links";
import { type AppVariant, type CentralAuthState, type CentralAuthUser, isAvatarColor } from "@openbot/contracts/ipc";
import {
  type MarketplaceListingLink,
  marketplaceListingFromWebAppSearch,
  WEB_APP_MARKETPLACE_AGENT_PARAM,
  WEB_APP_MARKETPLACE_SKILL_PARAM,
} from "@openbot/contracts/marketplace-links";
import { pluginSlugFromWebAppSearch, WEB_APP_PLUGIN_PARAM } from "@openbot/contracts/plugin-links";
import { forgetReferralCode, readReferralCode } from "@openbot/contracts/referral";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { formatLocale, resolveLocale } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { markRemoteSync } from "@openbot/team-client/sync-profile";
import { classifyFailure } from "@openbot/telemetry";
import { NotificationObserver, Toaster, toast } from "@openbot/ui";
import { AccountLogin } from "@openbot/ui/features/account/AccountLogin";
import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import { currentText } from "@openbot/ui/text";
import { Dynamic } from "@solidjs/web";
import { createEffect, createSignal, createStore, onSettled, Show } from "solid-js";
import type { DesktopAnalyticsProperties } from "../../analytics";
import {
  configureWebReports,
  reportNotification,
  setWebAccountPending,
  setWebReportsEnabled,
  webAccountPending,
  webKeepsOff,
  webReportsAgreed,
  webReportsEnabled,
} from "../../error-reports";
import { StaticI18nProvider } from "../../i18n-context";
import { startupLoadingScene } from "../../startup-animation-preference";
import { AnalyticsConsentRow, ConsentNotice } from "../onboarding/AnalyticsConsent";
import { createOnboardingTeam, onboardingSessionSeed } from "../onboarding/onboarding-avatars";
import { deleteRemoteWorkspaceFrames } from "../servers/remote-workspace-frame";
import { WindowBackdropBubbles } from "../window/backdrop-bubbles";
import { keepCachedWorkflows } from "../workflows/workflow-cache";
import { WebExtensionConnect } from "./WebExtensionConnect";
import { WebLanguageStep } from "./WebLanguageStep";
import { phoneAppScreenWanted, WebPhoneAppScreen } from "./WebPhoneAppScreen";
import { WebSlowLoadNotice } from "./WebSlowLoadNotice";
import type { WebWorkspace } from "./WebWorkspace";
import { createWebAccountCalls } from "./web-account";
import { deleteSavedAgentPictures } from "./web-agent-pictures";
import { createWebAppearancePreference } from "./web-appearance-preference";
import { takeWebAppStart, WEB_APP_BILLING_PARAM, type WebAppStart } from "./web-billing";
import { syncWebChatBackground } from "./web-chat-background";
import type { WebRuntimeFactory } from "./web-client-context";
import { extensionReturnUrl, forgetExtensionConnect, takeExtensionConnect } from "./web-extension-connect";
import { takeHostingReturn } from "./web-hosted-servers";
import { createWebLanguagePreference } from "./web-language-preference";

export { loadSavedLanguage } from "./web-language-preference";

let workspaceImport: Promise<typeof WebWorkspace> | null = null;
function loadWorkspace(): Promise<typeof WebWorkspace> {
  if (!workspaceImport) {
    workspaceImport = import("./WebWorkspace").then((module) => module.WebWorkspace);
    workspaceImport.catch(() => {
      workspaceImport = null;
    });
  }
  return workspaceImport;
}

class SignInIssueShown extends Error {
  constructor(readonly code: string) {
    super();
  }
}

class CompanySignInRequired extends Error {}

const EMAIL_START_TIMEOUT_MS = 35_000;

const SESSION_CHECK_TIMEOUT_MS = 15_000;

const EMAIL_START_KEY_LIFE_MS = 10 * 60_000;

const UNCERTAIN_EMAIL_DELIVERY = new Set([
  "email_delivery_pending",
  "email_delivery_timeout",
  "email_delivery_unknown",
]);

function takeCompanySignInError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get(WEB_APP_COMPANY_SIGN_IN_ERROR_PARAM);
  if (code === null) return null;
  url.searchParams.delete(WEB_APP_COMPANY_SIGN_IN_ERROR_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return code;
}

const COMPANY_SIGN_IN = Symbol("company sign-in");

function companySignInIssue(code: string) {
  return { code, message: sourceText(companySignInErrorKey(code)) };
}

function takeAgentTemplateLink(): string | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(WEB_APP_AGENT_TEMPLATE_PARAM)) return null;
  const id = agentTemplateIdFromWebAppSearch(url.search);
  url.searchParams.delete(WEB_APP_AGENT_TEMPLATE_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return id;
}

function takeInviteLink(): string | null {
  const url = new URL(window.location.href);
  if (!WEB_APP_INVITE_FIELDS.some((field) => url.searchParams.has(field))) return null;
  const inviteUrl = inviteUrlFromWebAppSearch(url.search, { allowLocalDevelopmentApiUrl: import.meta.env.DEV });
  for (const field of WEB_APP_INVITE_FIELDS) url.searchParams.delete(field);
  window.history.replaceState(window.history.state, "", url);
  return inviteUrl;
}

function takePluginLink(): string | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(WEB_APP_PLUGIN_PARAM)) return null;
  const slug = pluginSlugFromWebAppSearch(url.search);
  url.searchParams.delete(WEB_APP_PLUGIN_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return slug;
}

function takeMarketplaceLink(): MarketplaceListingLink | null {
  const url = new URL(window.location.href);
  const params = [WEB_APP_MARKETPLACE_AGENT_PARAM, WEB_APP_MARKETPLACE_SKILL_PARAM];
  if (!params.some((param) => url.searchParams.has(param))) return null;
  const link = marketplaceListingFromWebAppSearch(url.search);
  for (const param of params) url.searchParams.delete(param);
  window.history.replaceState(window.history.state, "", url);
  return link;
}

type BillingReturn = DesktopAnalyticsProperties<"billing_return_viewed">;

function takeBillingReturn(): BillingReturn | null {
  const url = new URL(window.location.href);
  const kind = url.searchParams.get(WEB_APP_BILLING_PARAM);
  if (kind === null) return null;
  const outcome = url.searchParams.get("cancelled") === "1" ? "cancelled" : "completed";
  for (const name of [WEB_APP_BILLING_PARAM, "cancelled"]) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
  return kind === "license" || kind === "portal" ? { outcome, kind } : { outcome };
}

function takeStartLink(): WebAppStart | null {
  const url = new URL(window.location.href);
  const start = takeWebAppStart(url);
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  return start;
}

export function WebApp(props: { createRuntime?: WebRuntimeFactory } = {}) {
  return (
    <WindowBackdropBubbles>
      <WebAppContent {...props} />
    </WindowBackdropBubbles>
  );
}

function WebAppContent(props: { createRuntime?: WebRuntimeFactory }) {
  const text = currentText();
  const [state, setState] = createStore<{
    account: CentralAuthUser | null;
    loaded: boolean;
    retrying: boolean;
    login: CentralAuthState;
    resendAt: number;
  }>({
    account: null,
    loaded: false,
    retrying: false,
    login: { status: "signed_out" },
    resendAt: 0,
  });
  createEffect(
    () => ({ account: state.account, loaded: state.loaded }),
    ({ account, loaded }) => {
      if (!loaded) return;
      configureWebReports(account);
      import("./web-analytics")
        .then((module) => {
          module.configureWebAnalytics(account);
          if (!account || !billingReturnEvent) return;
          module.trackBillingReturn(billingReturnEvent);
          billingReturnEvent = null;
        })
        .catch(() => undefined);
    },
  );
  const [analyticsAgreed, setAnalyticsAgreed] = createSignal(webReportsAgreed());
  const [analyticsChoice, setAnalyticsChoice] = createSignal(webReportsEnabled());
  let analyticsTouched = false;
  function resetAnalyticsBox() {
    setAnalyticsAgreed(webReportsAgreed());
    setAnalyticsChoice(webReportsEnabled());
    analyticsTouched = false;
  }
  const [agentTemplateId, setAgentTemplateId] = createSignal(takeAgentTemplateLink());
  const [inviteUrl, setInviteUrl] = createSignal(takeInviteLink());
  const [pluginSlug, setPluginSlug] = createSignal(takePluginLink());
  const [marketplaceListing, setMarketplaceListing] = createSignal(takeMarketplaceLink());
  const [startLink, setStartLink] = createSignal(takeStartLink());
  const extensionConnect = takeExtensionConnect();
  createEffect(
    () => state.loaded && !state.account,
    (signedOut) => {
      if (!signedOut || !extensionConnect?.silent) return;
      forgetExtensionConnect();
      window.location.assign(extensionReturnUrl(extensionConnect, { error: "login_required" }));
    },
  );
  const initialBillingReturn = takeBillingReturn();
  const initialHostingReturn = takeHostingReturn();
  const [billingReturn, setBillingReturn] = createSignal(initialBillingReturn !== null);
  const [hostingReturn, setHostingReturn] = createSignal(initialHostingReturn);
  let billingReturnEvent: BillingReturn | null =
    initialBillingReturn ??
    (initialHostingReturn ? { outcome: initialHostingReturn.paid ? "completed" : "cancelled", kind: "plan" } : null);
  let companySignInReturnError = takeCompanySignInError();
  const addressHadLink =
    agentTemplateId() !== null ||
    inviteUrl() !== null ||
    pluginSlug() !== null ||
    marketplaceListing() !== null ||
    startLink() !== null ||
    extensionConnect !== null ||
    initialBillingReturn !== null ||
    initialHostingReturn !== null ||
    companySignInReturnError !== null;
  const [workspace, setWorkspace] = createSignal<typeof WebWorkspace>();
  async function showAccount(account: CentralAuthUser) {
    const view = await loadWorkspace();
    setWorkspace(() => view);
    return account;
  }
  const [loadingShown, setLoadingShown] = createSignal(true);
  let channel: BroadcastChannel | null = null;
  let disposed = false;
  let sessionGeneration = 0;
  let sessionEnded = false;
  function clearSession(ended = true) {
    sessionEnded = ended;
    if (ended) {
      deleteRemoteWorkspaceFrames(null);
      void deleteSavedAgentPictures(null);
      keepCachedWorkflows(null);
    }
    sessionGeneration += 1;
    setState((draft) => {
      draft.account = null;
      draft.login = { status: "signed_out" };
    });
    resetAnalyticsBox();
  }
  const accountFetch: typeof fetch = async (input, init) => {
    const generation = sessionGeneration;
    const response = await fetch(input, init);
    if (
      !disposed &&
      generation === sessionGeneration &&
      response.status === 401 &&
      input !== "/api/browser/email/start" &&
      input !== "/api/browser/email/verify" &&
      input !== "/api/browser/company/start"
    ) {
      if (state.account) channel?.postMessage("session-changed");
      clearSession();
    }
    return response;
  };
  const accountCalls = createWebAccountCalls(accountFetch, checkSession);
  async function request(
    path: string,
    body?:
      | { email: string }
      | { challengeId: string | null; code: string; firstTouch?: FirstTouch; referralCode?: string }
      | Record<string, never>,
    send?: { idempotencyKey?: string; signal: AbortSignal },
  ) {
    const response = await accountFetch(`/api/browser/${path}`, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body
        ? {
            "Content-Type": "application/json",
            "X-OpenBot-Browser": "1",
            ...(send?.idempotencyKey ? { "Idempotency-Key": send.idempotencyKey } : {}),
          }
        : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(send ? { signal: send.signal } : {}),
    });
    const value = await response.json();
    if (!response.ok) {
      if (
        path === "email/start" &&
        isDynamicRecord(value) &&
        isDynamicRecord(value.error) &&
        value.error.code === "company_sign_in_required"
      )
        throw new CompanySignInRequired();
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
        throw new SignInIssueShown(issue.code);
      }
      throw new Error(
        isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message)
          ? value.error.message
          : text.t("webClient.login.requestFailed"),
      );
    }
    return value;
  }
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
      throw new Error(text.t("webClient.login.accountInvalid"));
    return {
      id: value.user.id,
      email: value.user.email,
      name: isString(value.user.name) ? value.user.name : null,
      avatarUrl: isString(value.user.avatarUrl) ? value.user.avatarUrl : null,
      analyticsEnabled: isBoolean(value.user.analyticsEnabled) ? value.user.analyticsEnabled : null,
      chatColor: isAvatarColor(value.user.chatColor) ? value.user.chatColor : null,
    };
  }
  async function followAccountAnalytics(answer: boolean | null | undefined) {
    const module = await import("./web-analytics");
    if (webAccountPending()) return module.sendWebAnalyticsChoice(accountCalls);
    if (answer === null || answer === undefined || answer === webReportsEnabled()) return;
    if (answer && webKeepsOff()) return;
    setWebReportsEnabled(answer);
    module.followWebReportsPreference();
  }
  async function checkSession() {
    const generation = sessionGeneration;
    void loadWorkspace().catch(() => undefined);
    const screenWaits = !state.loaded || (!state.account && state.login.status === "error");
    if (screenWaits && state.loaded)
      setState((draft) => {
        draft.retrying = true;
      });
    try {
      const session = await request(
        "session",
        undefined,
        screenWaits ? { signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS) } : undefined,
      );
      markRemoteSync("session");
      const account = await showAccount(accountFrom(session));
      markRemoteSync("workspace-code");
      if (!disposed && generation === sessionGeneration) {
        sessionEnded = false;
        setState((draft) => {
          draft.account = account;
        });
        void followAccountAnalytics(account.analyticsEnabled).catch(() => undefined);
      }
    } catch (error) {
      if (!disposed && generation === sessionGeneration) {
        if (state.account)
          toast.error(
            text.sourceText(error instanceof Error ? error.message : text.t("webClient.login.sessionFailed")),
            { report: { operation: "other", source: "system", cause_code: classifyFailure(error) } },
          );
        else
          setState((draft) => {
            draft.login = {
              status: "error",
              issue: {
                code: "auth_api_unavailable",
                message:
                  error instanceof DOMException && error.name === "TimeoutError"
                    ? sourceText("error.auth.sessionTimeout")
                    : sourceText("error.auth.serviceUnavailable"),
              },
            };
          });
      }
    } finally {
      const returnError = companySignInReturnError;
      companySignInReturnError = null;
      if (!disposed)
        setState((draft) => {
          draft.loaded = true;
          draft.retrying = false;
          if (returnError !== null && !draft.account && draft.login.status === "signed_out")
            draft.login = { status: "error", issue: companySignInIssue(returnError) };
        });
    }
  }
  let emailStart: { email: string; idempotencyKey: string; startedAt: number } | null = null;
  async function start(email: string) {
    if (Date.now() < state.resendAt) throw new Error(text.t("webClient.login.wait"));
    if (!analyticsAgreed()) {
      setWebReportsEnabled(analyticsChoice());
      if (analyticsTouched) setWebAccountPending(analyticsChoice());
      import("./web-analytics").then((module) => module.followWebReportsPreference()).catch(() => undefined);
    }
    const attempt =
      emailStart?.email === email && Date.now() - emailStart.startedAt < EMAIL_START_KEY_LIFE_MS
        ? emailStart
        : { email, idempotencyKey: crypto.randomUUID(), startedAt: Date.now() };
    emailStart = attempt;
    const limit = new AbortController();
    let timedOut = false;
    let uncertain = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      limit.abort();
    }, EMAIL_START_TIMEOUT_MS);
    const value = await request(
      "email/start",
      { email },
      { idempotencyKey: attempt.idempotencyKey, signal: limit.signal },
    )
      .catch((error: unknown) => {
        if (error instanceof CompanySignInRequired) return COMPANY_SIGN_IN;
        if (error instanceof SignInIssueShown) {
          uncertain = UNCERTAIN_EMAIL_DELIVERY.has(error.code);
          return null;
        }
        if (!timedOut) throw error;
        uncertain = true;
        setState((draft) => {
          draft.login = {
            status: "error",
            issue: { code: "email_delivery_timeout", message: sourceText("error.auth.deliveryTimeout") },
          };
        });
        return null;
      })
      .finally(() => window.clearTimeout(timer));
    if (emailStart === attempt && !uncertain) emailStart = null;
    if (value === null) return;
    if (value === COMPANY_SIGN_IN) return openCompanySignIn(email);
    if (!isDynamicRecord(value) || !isString(value.challengeId) || typeof value.resendAt !== "number")
      throw new Error(text.t("webClient.login.responseInvalid"));
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
  async function openCompanySignIn(email: string) {
    setState((draft) => {
      draft.login = { status: "company_sign_in", email };
    });
    const response = await accountFetch("/api/browser/company/start", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-OpenBot-Browser": "1" },
      body: JSON.stringify({ email }),
    });
    const value = await response.json().catch(() => null);
    if (response.ok && isDynamicRecord(value) && isString(value.authorizationUrl)) {
      window.location.assign(value.authorizationUrl);
      return;
    }
    const code =
      isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.code)
        ? value.error.code
        : "company_sign_in_failed";
    setState((draft) => {
      draft.login = { status: "company_sign_in", email, issue: companySignInIssue(code) };
    });
  }
  async function verify(challengeId: string, code: string, referralCode?: string) {
    const firstTouch = readFirstTouch(() => window.localStorage, Date.now());
    const value = await signInRequest("email/verify", {
      challengeId,
      code,
      ...(firstTouch ? { firstTouch } : {}),
      ...(referralCode ? { referralCode } : {}),
    });
    if (value === null) return;
    forgetReferralCode(() => window.localStorage);
    const account = accountFrom(value);
    sessionGeneration += 1;
    sessionEnded = false;
    channel?.postMessage("session-changed");
    try {
      await showAccount(account);
    } catch {
      setState((draft) => {
        draft.login = {
          status: "error",
          issue: { code: "auth_api_unavailable", message: sourceText("error.auth.serviceUnavailable") },
        };
      });
      return;
    }
    setState((draft) => {
      draft.account = account;
    });
    void followAccountAnalytics(account.analyticsEnabled).catch(() => undefined);
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
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
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
  const consentAgents = createOnboardingTeam(onboardingSessionSeed(), 3);
  const languagePreference = createWebLanguagePreference();
  const appearancePreference = createWebAppearancePreference();
  onSettled(() => syncWebChatBackground());
  const [languageWheelOpen, setLanguageWheelOpen] = createSignal(false);
  const [phoneAppShown, setPhoneAppShown] = createSignal(!addressHadLink && phoneAppScreenWanted());
  return (
    <StaticI18nProvider
      locale={resolveLocale(languagePreference.language(), navigator.language)}
      formatLocale={formatLocale(languagePreference.language(), navigator.language)}
    >
      <NotificationObserver onShown={reportNotification}>
        <div class="web-app">
          <Toaster onToastShown={reportNotification} />
          <Show when={state.loaded && phoneAppShown()}>
            <WebPhoneAppScreen variant={variant} onContinue={() => setPhoneAppShown(false)} />
          </Show>
          <Show when={state.loaded && !phoneAppShown()}>
            <Show
              keyed
              when={state.account?.id}
              fallback={
                <Show
                  when={!languageWheelOpen()}
                  fallback={
                    <WebLanguageStep
                      variant={variant}
                      language={languagePreference.language()}
                      onChangeLanguage={languagePreference.setLanguage}
                      onDone={() => setLanguageWheelOpen(false)}
                    />
                  }
                >
                  <AccountLogin
                    variant={variant}
                    language={resolveLocale(languagePreference.language(), navigator.language)}
                    onChangeLanguage={() => setLanguageWheelOpen(true)}
                    state={state.login}
                    onRetry={checkSession}
                    onRequestEmailCode={start}
                    onVerifyEmailCode={verify}
                    inviteField
                    initialInviteCode={readReferralCode(() => window.localStorage, Date.now()) ?? undefined}
                    revealed={!loadingShown()}
                    onOpenCompanySignIn={() =>
                      state.login.status === "company_sign_in"
                        ? openCompanySignIn(state.login.email)
                        : Promise.resolve()
                    }
                    onReset={async () => {
                      clearSession();
                      setState((draft) => {
                        draft.resendAt = 0;
                      });
                    }}
                    consent={
                      <Show when={!analyticsAgreed()}>
                        <AnalyticsConsentRow
                          class="web-consent-row"
                          checked={analyticsChoice()}
                          agents={consentAgents}
                          onChange={(checked) => {
                            analyticsTouched = true;
                            setAnalyticsChoice(checked);
                          }}
                        />
                      </Show>
                    }
                    notice={
                      <ConsentNotice
                        onOpenTerms={() => window.open("/terms", "_blank", "noopener")}
                        onOpenPrivacy={() => window.open("/privacy", "_blank", "noopener")}
                      />
                    }
                  />
                </Show>
              }
            >
              {(accountId) => (
                <Show
                  when={extensionConnect}
                  fallback={
                    <Dynamic
                      component={workspace()}
                      accountId={accountId}
                      accountEmail={state.account?.email ?? ""}
                      accountName={state.account?.name ?? null}
                      accountAvatarUrl={state.account?.avatarUrl ?? null}
                      accountChatColor={state.account?.chatColor ?? null}
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
                      marketplaceListing={marketplaceListing()}
                      onMarketplaceListingConsumed={() => setMarketplaceListing(null)}
                      start={startLink()}
                      onStartConsumed={() => setStartLink(null)}
                      billingReturn={billingReturn()}
                      onBillingReturnConsumed={() => setBillingReturn(false)}
                      hostingReturn={hostingReturn()}
                      onHostingReturnConsumed={() => setHostingReturn(null)}
                      language={languagePreference.language()}
                      onChangeLanguage={languagePreference.setLanguage}
                      appearance={appearancePreference.appearance()}
                      onChangeAppearance={appearancePreference.setAppearance}
                    />
                  }
                >
                  {(request) => (
                    <WebExtensionConnect
                      variant={variant}
                      request={request()}
                      accountId={accountId}
                      email={state.account?.email ?? ""}
                      accountFetch={accountFetch}
                    />
                  )}
                </Show>
              )}
            </Show>
          </Show>
          <Show when={loadingShown()}>
            <AppLoadingScreen
              label={text.t("app.loading")}
              title={text.t("app.loading")}
              scene={startupLoadingScene()}
              ready={state.loaded}
              onExited={() => {
                setLoadingShown(false);
                void loadWorkspace().catch(() => undefined);
              }}
            />
          </Show>
          <Show when={!state.loaded}>
            <WebSlowLoadNotice />
          </Show>
          <Show when={state.retrying}>
            <WebSlowLoadNotice startsWait />
          </Show>
        </div>
      </NotificationObserver>
    </StaticI18nProvider>
  );
}
