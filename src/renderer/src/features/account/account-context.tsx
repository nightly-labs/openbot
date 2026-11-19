import {
  type AccountUsage,
  type AccountUsageLimit,
  type AvatarColor,
  type AvatarImageInput,
  type CentralAuthState,
  keepUsageCredits,
  withReadCredits,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createMemo, createSignal, createStore, flush, onCleanup, onSettled } from "solid-js";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";
import { createSimpleContext } from "../../simple-context";
import { accountPort } from "./account-port";

type MobileConnectAction = DesktopAnalyticsProperties<"mobile_connect_action">["action"];

const AUTH_SUCCESS_HOLD_MS = 600;

function authFailureCode(value: string | undefined): string {
  switch (value) {
    case "auth_api_error":
    case "code_recently_sent":
    case "email_delivery_failed":
    case "email_delivery_not_configured":
    case "email_delivery_rate_limited":
    case "email_sign_in_failed":
    case "email_sign_in_start_failed":
    case "invalid_email":
    case "invalid_sign_in_code":
    case "rate_limited":
    case "sign_in_code_expired":
    case "too_many_code_attempts":
    case "unauthorized":
      return value;
    default:
      return "unknown";
  }
}

const Auth = createSimpleContext({
  name: "Auth",
  init: () => {
    const [centralAuth, setCentralAuth] = createSignal<CentralAuthState>({ status: "loading" });
    const [authSuccessVisible, setAuthSuccessVisible] = createSignal(false);
    const [accountUsageState, setAccountUsageState] = createStore<{
      targetKey: string | null;
      data: AccountUsage | null;
      refreshRevision: number;
    }>({ targetKey: null, data: null, refreshRevision: 0 });
    let accountUsageRequestGeneration = 0;
    let accountUsageEventIds = new Set<string>();
    let authSuccessTimer: ReturnType<typeof setTimeout> | undefined;
    let knownMobileDevices: ReadonlySet<string> | null = null;

    onCleanup(() => {
      if (authSuccessTimer !== undefined) clearTimeout(authSuccessTimer);
    });

    function applyCentralAuthState(state: CentralAuthState): void {
      desktopAnalytics.setUser(state.status === "signed_in" ? state.user : null);
      if (state.status !== "signed_in") knownMobileDevices = null;
      const completedCodeChallenge = centralAuth().status === "code_sent" && state.status === "signed_in";
      if (state.status !== "signed_in") {
        if (authSuccessTimer !== undefined) clearTimeout(authSuccessTimer);
        authSuccessTimer = undefined;
        setAuthSuccessVisible(false);
      } else if (completedCodeChallenge) {
        if (authSuccessTimer !== undefined) clearTimeout(authSuccessTimer);
        setAuthSuccessVisible(true);
        authSuccessTimer = setTimeout(() => {
          authSuccessTimer = undefined;
          setAuthSuccessVisible(false);
        }, AUTH_SUCCESS_HOLD_MS);
      }
      setCentralAuth(state);
    }

    onSettled(() => {
      const unsubscribe = accountPort().auth.onEvent((state) => {
        flush(() => applyCentralAuthState(state));
      });
      void accountPort()
        .auth.getState()
        .then(setCentralAuth)
        .catch(() =>
          setCentralAuth({
            status: "error",
            issue: {
              code: "auth_unavailable",
              message: currentText().t("account.login.loadFailed"),
            },
          }),
        );
      return unsubscribe;
    });

    async function requestEmailCode(email: string): Promise<void> {
      const analytics = desktopAnalytics.anonymousScope();
      try {
        const state = await accountPort().auth.requestEmailCode(email);
        analytics.track("account_sign_in_started", {
          result: state.status === "code_sent" || state.status === "company_sign_in" ? state.status : "failed",
          ...(state.status === "error" ? { failure_code: authFailureCode(state.issue.code) } : {}),
        });
        applyCentralAuthState(state);
      } catch (error) {
        analytics.track("account_sign_in_started", {
          result: "failed",
          failure_code: "request_failed",
        });
        throw error;
      }
    }

    async function openCompanySignIn(): Promise<void> {
      applyCentralAuthState(await accountPort().auth.openCompanySignIn());
    }

    async function retryCentralAccount(): Promise<void> {
      applyCentralAuthState({ status: "loading" });
      applyCentralAuthState(await accountPort().auth.retry());
    }

    async function verifyEmailCode(challengeId: string, code: string): Promise<void> {
      const anonymousAnalytics = desktopAnalytics.anonymousScope();
      try {
        const state = await accountPort().auth.verifyEmailCode({ challengeId, code });
        applyCentralAuthState(state);
        desktopAnalytics.track("account_sign_in_completed", {
          result: state.status === "signed_in" ? "succeeded" : "failed",
          ...("issue" in state ? { failure_code: authFailureCode(state.issue?.code) } : {}),
        });
      } catch (error) {
        anonymousAnalytics.track("account_sign_in_completed", {
          result: "failed",
          failure_code: "verification_failed",
        });
        throw error;
      }
    }

    async function logoutCentralAccount(): Promise<void> {
      const analytics = desktopAnalytics.scope();
      try {
        const state = await accountPort().auth.logout();
        analytics.track("account_sign_out", { result: "succeeded" });
        applyCentralAuthState(state);
      } catch (error) {
        analytics.track("account_sign_out", {
          result: "failed",
          failure_code: "sign_out_failed",
        });
        throw error;
      }
    }

    async function updateAccountAvatar(image: AvatarImageInput | null): Promise<void> {
      applyCentralAuthState(await accountPort().auth.updateAvatar(image));
    }

    async function updateAccountName(name: string): Promise<void> {
      applyCentralAuthState(await accountPort().auth.updateName(name));
    }

    async function setChatColor(color: AvatarColor | null): Promise<void> {
      applyCentralAuthState(await accountPort().auth.updateChatColor(color));
    }

    const accountUsage = () => accountUsageState.data;
    const accountUsageRefreshRevision = () => accountUsageState.refreshRevision;
    const accountUsageTargetKey = () => accountUsageState.targetKey;

    function selectAccountUsageTarget(targetKey: string | null): void {
      if (accountUsageState.targetKey === targetKey) return;
      accountUsageRequestGeneration += 1;
      setAccountUsageState((state) => {
        state.targetKey = targetKey;
      });
    }

    function invalidateAccountUsage(): void {
      accountUsageRequestGeneration += 1;
      setAccountUsageState((state) => {
        state.data = null;
        state.refreshRevision += 1;
      });
    }

    function applyAccountUsage(usage: AccountUsage): void {
      if (usage.limits.length === 0) {
        accountUsageRequestGeneration += 1;
        setAccountUsageState((state) => {
          state.data = usage;
        });
        return;
      }
      for (const limit of usage.limits) accountUsageEventIds.add(usageLimitKey(limit));
      setAccountUsageState((state) => {
        const byId = new Map((state.data?.limits ?? []).map((limit) => [usageLimitKey(limit), limit]));
        for (const limit of usage.limits) {
          const key = usageLimitKey(limit);
          byId.set(key, keepUsageCredits(byId.get(key), limit));
        }
        state.data = { limits: [...byId.values()] };
      });
    }

    async function refreshAccountUsage(targetKey: string): Promise<AccountUsage> {
      selectAccountUsageTarget(targetKey);
      const generation = ++accountUsageRequestGeneration;
      accountUsageEventIds = new Set();
      const usage = await accountPort().agent.getUsage();
      if (generation === accountUsageRequestGeneration && accountUsageState.targetKey === targetKey) {
        setAccountUsageState((state) => {
          const byId = new Map(usage.limits.map((limit) => [usageLimitKey(limit), limit]));
          for (const limit of state.data?.limits ?? []) {
            const key = usageLimitKey(limit);
            if (accountUsageEventIds.has(key)) byId.set(key, withReadCredits(byId.get(key), limit));
          }
          state.data = { limits: [...byId.values()] };
        });
      }
      return usage;
    }

    function trackMobileConnect<Result>(action: MobileConnectAction, call: () => Promise<Result>): Promise<Result> {
      return call().then(
        (result) => {
          desktopAnalytics.track("mobile_connect_action", { action, result: "succeeded" });
          return result;
        },
        (error: unknown) => {
          desktopAnalytics.track("mobile_connect_action", { action, result: "failed" });
          throw error;
        },
      );
    }

    function createMobileConnect() {
      return trackMobileConnect("code_shown", () => accountPort().auth.createMobileConnect());
    }

    async function listMobileConnectedDevices() {
      const devices = await accountPort().auth.listMobileConnectedDevices();
      const ids = new Set(devices.map((device) => device.sessionId));
      const known = knownMobileDevices;
      if (known) {
        for (const id of ids) {
          if (!known.has(id))
            desktopAnalytics.track("mobile_connect_action", { action: "connected", result: "succeeded" });
        }
      }
      knownMobileDevices = ids;
      return devices;
    }

    function revokeMobileConnectedDevice(sessionId: string) {
      return trackMobileConnect("revoked", () => accountPort().auth.revokeMobileConnectedDevice(sessionId));
    }

    const signedInAccount = createMemo(() => {
      const state = centralAuth();
      return state.status === "signed_in" ? state.user : null;
    });
    const visibleSignedInAccount = createMemo(() => (authSuccessVisible() ? null : signedInAccount()));

    return {
      centralAuth,
      signedInAccount,
      visibleSignedInAccount,
      accountUsage,
      accountUsageRefreshRevision,
      accountUsageTargetKey,
      selectAccountUsageTarget,
      invalidateAccountUsage,
      applyAccountUsage,
      refreshAccountUsage,
      requestEmailCode,
      openCompanySignIn,
      retryCentralAccount,
      verifyEmailCode,
      logoutCentralAccount,
      updateAccountName,
      updateAccountAvatar,
      setChatColor,
      createMobileConnect,
      cancelMobileConnect: () => trackMobileConnect("cancelled", () => accountPort().auth.cancelMobileConnect()),
      getMobileConnectLink: () => accountPort().auth.getMobileConnectLink(),
      createMobileConnectLink: () =>
        trackMobileConnect("link_created", () => accountPort().auth.createMobileConnectLink()),
      revokeMobileConnectLink: () =>
        trackMobileConnect("link_revoked", () => accountPort().auth.revokeMobileConnectLink()),
      listMobileConnectedDevices,
      revokeMobileConnectedDevice,
      listAccountSessions: () => accountPort().auth.listAccountSessions(),
      revokeAccountSession: (sessionId: string) => accountPort().auth.revokeAccountSession(sessionId),
    };
  },
});

export const AuthProvider = Auth.provider;
export const useAuth = Auth.use;

function usageLimitKey(limit: AccountUsageLimit): string {
  return `${limit.id}\n${limit.accountId ?? ""}`;
}
