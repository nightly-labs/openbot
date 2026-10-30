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
// The verified state shows for a moment before the app replaces the sign-in screen.
const VERIFIED_PAUSE_MS = 450;
// The longest wait for the keyboard to close. A keyboard that reports no event must not stop the
// way back.
const KEYBOARD_HIDE_LIMIT_MS = 600;

/** Closes the keyboard and waits until it is gone. */
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

/**
 * The email sign-in steps of the sign-in screen. `connect` receives the new session, and may play
 * the departure from the sign-in screen before it resolves.
 */
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
  // Each rejected value shakes its field again, also for the same message.
  const [rejection, setRejection] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<"send" | "resend" | "verify" | null>(null);
  const [verified, setVerified] = useState(false);
  // The code expired or took too many attempts. Only a new code unlocks the field.
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState(0);
  // One request ID per code. An unconfirmed delivery keeps it, so the next press checks that code.
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
    // Back on the email step, the same address keeps the code that is already on its way.
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

  async function verify(value: string) {
    if (!challenge || pending || verified || needsNewCode) return;
    setPending("verify");
    setCodeIssue(null);
    setNotice(null);
    try {
      const session = await mobileAnalytics.operation("account_sign_in_completed", { method: "email" }, () =>
        verifyMobileEmailCode(challenge.challengeId, value),
      );
      setVerified(true);
      void haptics.notification("success");
      // The keyboard closes while the verified state shows, so the screen is still when it leaves.
      await Promise.all([
        reduced ? undefined : new Promise((resolve) => setTimeout(resolve, VERIFIED_PAUSE_MS)),
        closeKeyboard(),
      ]);
      await connect(session);
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
  /** The previous step: code to email, email to the sign-in options. */
  async function back() {
    // A send or a verify ends on the code step or in the app, so the way back waits for it. The
    // Android back button calls this directly, without the disabled state of the on-screen button.
    if (pending === "send" || pending === "verify" || verified || leaving.current) return;
    const target = step === "code" ? "email" : "options";
    // Back to the options, the keyboard closes first and the screen changes after it is gone, so
    // the two movements do not overlap. Back to the email, the keyboard stays for the field.
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
      setBlockedUntil(0);
      requestId.current = null;
    },
    emailIssue,
    sendCode: () => void requestCode("send"),
    resendCode: () => void requestCode("resend"),
    sending: pending === "send",
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
