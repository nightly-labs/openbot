import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { classifyFailure } from "@openbot/telemetry";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import {
  type MobileEmailChallenge,
  MobileEmailSignInError,
  type MobileSession,
  signInMobileWithCompany,
  startMobileEmailSignIn,
  verifyMobileEmailCode,
} from "@/features/auth/api/mobile-auth";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export type SignInStep = "options" | "email" | "code";

export interface SignInIssue {
  message: string;
  code: string;
  retryAfterSeconds?: number;
}

const CODE_ISSUES = new Set(["invalid_sign_in_code", "sign_in_code_expired", "too_many_code_attempts"]);
const NEW_CODE_ISSUES = new Set(["sign_in_code_expired", "too_many_code_attempts"]);
const UNCONFIRMED_DELIVERY = new Set(["email_delivery_pending", "email_delivery_timeout", "email_delivery_unknown"]);
const VERIFIED_PAUSE_MS = 450;
const KEYBOARD_HIDE_LIMIT_MS = 600;

function closeKeyboard(): Promise<void> {
  if (!Keyboard.isVisible()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      subscription.remove();
      clearTimeout(limit);
      resolve();
    };
    const subscription = Keyboard.addListener("keyboardDidHide", finish);
    const limit = setTimeout(finish, KEYBOARD_HIDE_LIMIT_MS);
    Keyboard.dismiss();
  });
}

function useSecondsUntil(until: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1_000);
    return () => clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1_000));
}

export function formatTimer(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function useEmailSignIn({
  connect,
  reduced,
}: {
  connect: (session: MobileSession) => void | Promise<void>;
  reduced: boolean;
}) {
  const { t, errorMessage } = useText();
  const [step, setStep] = useState<SignInStep>("options");

  const [email, setEmail] = useState("");
  const [emailIssue, setEmailIssue] = useState<SignInIssue | null>(null);
  const [challenge, setChallenge] = useState<MobileEmailChallenge | null>(null);
  const [code, setCode] = useState("");
  const [codeIssue, setCodeIssue] = useState<SignInIssue | null>(null);
  const [rejection, setRejection] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<"send" | "resend" | "verify" | "company" | null>(null);
  const [companyEmail, setCompanyEmail] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const requestId = useRef<string | null>(null);
  const retryIn = useSecondsUntil(blockedUntil);
  const resendIn = useSecondsUntil(Math.max(blockedUntil, challenge?.resendAt ?? 0));

  function go(target: SignInStep) {
    setStep(target);
  }

  function issueFrom(error: unknown, fallback: string): SignInIssue {
    if (error instanceof MobileEmailSignInError) {
      return {
        message: error.message,
        code: error.code,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      };
    }
    return { message: errorMessage(error, fallback), code: "" };
  }

  function reject() {
    setRejection((count) => count + 1);
    void haptics.notification("error");
  }

  async function requestCode(kind: "send" | "resend") {
    if (pending) return;
    if (kind === "send" && retryIn > 0) return;
    const address = normalizeEmailAddress(email);
    if (!address) {
      setEmailIssue({ message: t("mobile.auth.email.error.invalidEmail"), code: "invalid_email" });
      reject();
      return;
    }
    if (kind === "send" && companyEmail === address) {
      await signInWithCompany(address);
      return;
    }
    if (kind === "send" && !needsNewCode && challenge?.email === address && Date.now() < challenge.resendAt) {
      go("code");
      return;
    }
    requestId.current ??= Crypto.randomUUID();
    setPending(kind);
    setEmailIssue(null);
    setNotice(null);
    const scope = mobileAnalytics.scope();
    const started = performance.now();
    try {
      const next = await startMobileEmailSignIn(address, requestId.current);
      scope.track("account_sign_in_started", {
        method: "email",
        result: "code_sent",
        duration_ms: performance.now() - started,
      });
      requestId.current = null;
      setChallenge(next);
      setNeedsNewCode(false);
      setCode("");
      setCodeIssue(null);
      if (kind === "send") {
        go("code");
      } else {
        setNotice(t("mobile.auth.email.codeResent"));
        void haptics.notification("success");
      }
    } catch (error) {
      if (error instanceof MobileEmailSignInError && error.code === "company_sign_in_required") {
        scope.track("account_sign_in_started", {
          method: "email",
          result: "company_sign_in",
          duration_ms: performance.now() - started,
        });
        requestId.current = null;
        setPending(null);
        setCompanyEmail(address);
        go("email");
        await signInWithCompany(address);
        return;
      }
      scope.track("account_sign_in_started", {
        method: "email",
        result: "failed",
        failure_code: "operation_failed",
        cause_code: classifyFailure(error),
        duration_ms: performance.now() - started,
      });
      const issue = issueFrom(error, t("mobile.auth.email.error.sendFailed"));
      if (!UNCONFIRMED_DELIVERY.has(issue.code)) requestId.current = null;
      if (issue.retryAfterSeconds) setBlockedUntil(Date.now() + issue.retryAfterSeconds * 1_000);
      if (kind === "send") setEmailIssue(issue);
      else setCodeIssue(issue);
      reject();
    } finally {
      setPending(null);
    }
  }

  async function finish(session: MobileSession) {
    setVerified(true);
    void haptics.notification("success");
    await Promise.all([
      reduced ? undefined : new Promise((resolve) => setTimeout(resolve, VERIFIED_PAUSE_MS)),
      closeKeyboard(),
    ]);
    await connect(session);
  }

  async function signInWithCompany(address: string) {
    setPending("company");
    setEmailIssue(null);
    const scope = mobileAnalytics.scope();
    const started = performance.now();
    try {
      const session = await signInMobileWithCompany(address).catch((error: unknown) => {
        scope.track("account_sign_in_completed", {
          method: "company",
          result: "failed",
          failure_code: "operation_failed",
          cause_code: classifyFailure(error),
          duration_ms: performance.now() - started,
        });
        throw error;
      });
      scope.track("account_sign_in_completed", {
        method: "company",
        result: session ? "succeeded" : "cancelled",
        duration_ms: performance.now() - started,
      });
      if (session) await finish(session);
    } catch (error) {
      const issue = issueFrom(error, t("error.auth.companySignInFailed"));
      if (issue.code === "company_sign_in_not_found") setCompanyEmail(null);
      if (issue.retryAfterSeconds) setBlockedUntil(Date.now() + issue.retryAfterSeconds * 1_000);
      setEmailIssue(issue);
      reject();
    } finally {
      setPending(null);
    }
  }

  async function verify(value: string) {
    if (!challenge || pending || verified || needsNewCode) return;
    setPending("verify");
    setCodeIssue(null);
    setNotice(null);
    try {
      const session = await mobileAnalytics.operation("account_sign_in_completed", { method: "email" }, () =>
        verifyMobileEmailCode(challenge.challengeId, value),
      );
      await finish(session);
    } catch (error) {
      const issue = issueFrom(error, t("mobile.auth.email.error.verifyFailed"));
      setCodeIssue(issue);
      if (NEW_CODE_ISSUES.has(issue.code)) setNeedsNewCode(true);
      if (CODE_ISSUES.has(issue.code)) {
        setCode("");
        reject();
      } else {
        void haptics.notification("error");
      }
    } finally {
      setPending(null);
    }
  }

  const leaving = useRef(false);
  async function back() {
    if (pending === "send" || pending === "verify" || pending === "company" || verified || leaving.current) return;
    const target = step === "code" ? "email" : "options";
    if (target === "options") {
      leaving.current = true;
      try {
        await closeKeyboard();
      } finally {
        leaving.current = false;
      }
    }
    setEmailIssue(null);
    setCodeIssue(null);
    setNotice(null);
    setCode("");
    go(target);
  }

  const deliveryUnconfirmed = Boolean(emailIssue && UNCONFIRMED_DELIVERY.has(emailIssue.code));
  return {
    step,
    openEmail: () => go("email"),
    back: () => void back(),
    email,
    setEmail: (value: string) => {
      setEmail(value);
      setEmailIssue(null);
      if (normalizeEmailAddress(value) !== companyEmail) setCompanyEmail(null);
      setBlockedUntil(0);
      requestId.current = null;
    },
    emailIssue,
    sendCode: () => void requestCode("send"),
    resendCode: () => void requestCode("resend"),
    sending: pending === "send" || pending === "company",
    companySignIn: pending === "company",
    usesCompanySignIn: companyEmail !== null && companyEmail === normalizeEmailAddress(email),
    resending: pending === "resend",
    retryIn,
    resendIn,
    deliveryUnconfirmed,
    challenge,
    code,
    setCode: (value: string) => {
      setCode(value);
      setNotice(null);
      setCodeIssue(null);
    },
    verify: (value: string) => void verify(value),
    retryVerify: () => void verify(code),
    verifying: pending === "verify",
    verified,
    codeIssue,
    codeRejected: Boolean(codeIssue && CODE_ISSUES.has(codeIssue.code)),
    needsNewCode,
    notice,
    rejection,
    busy: pending !== null || verified,
  };
}

export type EmailSignIn = ReturnType<typeof useEmailSignIn>;
