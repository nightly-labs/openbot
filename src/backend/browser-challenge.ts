import type { BrowserChallenge } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Option } from "effect";
import type { WebContents } from "electron";
import { automationContextId, type SendCommand } from "./browser-cdp-values";

/** How long a snapshot waits for a check that clears by itself, such as a Cloudflare interstitial. */
export const CHALLENGE_WAIT_MS = 15_000;

/** How often the snapshot reads the page again while it waits. */
export const CHALLENGE_POLL_MS = 1_000;

/** The check reads the DOM only. A slow page must not hold the snapshot. */
const CHECK_TIMEOUT_MS = 1_000;

/**
 * A bot check that the page shows. `non-interactive` clears by itself after a short wait,
 * `interactive` needs a person, and `block` refuses this browser.
 */
export interface DetectedChallenge {
  vendor: string;
  kind: "non-interactive" | "interactive" | "block";
  signal: string;
}

/**
 * Runs in an isolated world and reads only the DOM: page globals are not visible there. Vendor
 * markers are specific to the interstitial page, not to the scripts that these vendors also put on
 * ordinary pages. Generic phrases and captcha frames count only on a short page, because a long page
 * that only mentions a check, or has a captcha in one form, is still usable.
 */
const CHALLENGE_SCRIPT = String.raw`(() => {
  const body = document.body;
  const title = (document.title || "").trim();
  const raw = body ? body.textContent || "" : "";
  const text = raw.length < 8000 && body ? (body.innerText || "").replace(/\s+/g, " ").trim() : "";
  const short = raw.length < 8000 && text.length < 1500;
  const has = (selector) => document.querySelector(selector) !== null;
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 20 && rect.height > 20;
  };
  const frame = (pattern) =>
    [...document.querySelectorAll("iframe")].some((element) => {
      const source = element.src || "";
      return pattern.test(source) && !/size=invisible/.test(source) && visible(element);
    });
  const found = (vendor, kind, signal) => ({ vendor, kind, signal });

  if ((has("#cf-error-details") || has(".cf-error-code")) && /blocked|error 10(0[0-9]|20)|access denied/i.test(text))
    return found("cloudflare", "block", "cloudflare-error-page");
  // Ordinary pages use ids such as "challenge-form" too, so a Cloudflare id counts only with a
  // Cloudflare script or frame, or on a short page.
  const cloudflare = frame(/challenges\.cloudflare\.com/) || has("script[src*='/cdn-cgi/challenge-platform/']");
  if ((cloudflare || short) && has("#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running, .cf-browser-verification, #cf-please-wait"))
    return found("cloudflare", "non-interactive", "cloudflare-challenge-markup");
  if ((/^(just a moment|attention required)/i.test(title) && short) || (/^one more step/i.test(title) && cloudflare))
    return found("cloudflare", "non-interactive", "cloudflare-title");
  if (frame(/captcha-delivery\.com/)) return found("datadome", "interactive", "datadome-frame");
  if (has("#px-captcha")) return found("perimeterx", "interactive", "px-captcha");
  if (/incapsula incident id/i.test(text)) return found("imperva", "block", "incapsula-incident");
  if (short && frame(/_Incapsula_Resource/)) return found("imperva", "interactive", "incapsula-frame");
  if (/^access denied/i.test(title) && /reference #\s*\d+\.[0-9a-f]+/i.test(text))
    return found("akamai", "block", "akamai-reference");
  if (has("#sec-if-cpt-container, #sec-cpt-if") || (short && has("#sec-container")))
    return found("akamai", "non-interactive", "akamai-sec-cpt");
  // Sites that use the AWS WAF integration SDK load its scripts on each page. Only the interstitial
  // counts: the script in the head and its container as a direct child of the body.
  if (has("html:has(head > script[src*='.awswaf.com/'][src$='/captcha.js']) > body > #captcha-container"))
    return found("aws-waf", "interactive", "aws-waf-captcha");
  if (has("html:has(head > script[src*='.awswaf.com/'][src$='/challenge.js']) > body > #challenge-container"))
    return found("aws-waf", "non-interactive", "aws-waf-challenge");
  if (!short) return null;
  if (frame(/challenges\.cloudflare\.com/)) return found("turnstile", "interactive", "turnstile-frame");
  if (frame(/hcaptcha\.com/)) return found("hcaptcha", "interactive", "hcaptcha-frame");
  if (frame(/\/recaptcha\/(api2|enterprise)\/|recaptcha\.net/)) return found("recaptcha", "interactive", "recaptcha-frame");
  if (/you have been blocked|your request (has been|was) blocked|request blocked/i.test(text) || /^(access denied|403 forbidden)/i.test(title))
    return found("generic", "block", "block-text");
  if (/checking (if the site connection is secure|your browser)|verifying you are human|please wait while we (verify|check)/i.test(text))
    return found("generic", "non-interactive", "wait-text");
  if (/verify (that )?you are (a )?human|are you a robot|press (and|&) hold|complete the security check|unusual traffic from your (computer|network)/i.test(text))
    return found("generic", "interactive", "captcha-text");
  return null;
})()`;

function challengeKind(value: unknown): DetectedChallenge["kind"] | null {
  return value === "non-interactive" || value === "interactive" || value === "block" ? value : null;
}

function readChallenge(value: unknown): DetectedChallenge | null {
  if (!isDynamicRecord(value)) return null;
  const kind = challengeKind(value.kind);
  if (!kind || !isString(value.vendor) || !isString(value.signal)) return null;
  return { vendor: value.vendor, kind, signal: value.signal };
}

/**
 * Reads the main frame for a bot check in the isolated automation world, so the page cannot change
 * what it reads. It uses CDP like the snapshot: on Linux, `executeJavaScriptInIsolatedWorld` does not
 * return for a document whose navigation was stopped. A failure or a non-web page gives `null`.
 */
export const detectChallenge = Effect.fn("Browser.detectChallenge")(function* (
  contents: WebContents,
  send: SendCommand,
) {
  if (contents.isDestroyed()) return null;
  const url = contents.getURL();
  if (!url.startsWith("https://") && !url.startsWith("http://")) return null;
  return yield* Effect.gen(function* () {
    const contextId = yield* automationContextId(send);
    const result = yield* send("Runtime.evaluate", { expression: CHALLENGE_SCRIPT, contextId, returnByValue: true });
    return isDynamicRecord(result.result) ? result.result.value : undefined;
  }).pipe(
    Effect.map(readChallenge),
    Effect.timeoutOption(CHECK_TIMEOUT_MS),
    Effect.map((option) => Option.getOrNull(option)),
    Effect.catch(() => Effect.succeed(null)),
  );
});

const NEEDS_USER_NEXT =
  "A person must pass this security check. Do not reload, retry, or try to solve it. Call request_takeover so the user solves it; in a routine run, report it.";

/** The line that the model reads in the snapshot. */
export function describeChallenge(
  detected: DetectedChallenge | null,
  clearedVendor: string | null,
  waitedMs: number,
  /** The check passes by itself, and its wait has time left for the next read. */
  checking = false,
): BrowserChallenge | undefined {
  if (detected?.kind === "block")
    return {
      vendor: detected.vendor,
      status: "blocked",
      waitedMs,
      next: "The site's bot protection refuses this browser. Do not reload or retry; report it to the user.",
    };
  if (detected?.kind === "non-interactive" && checking)
    return {
      vendor: detected.vendor,
      status: "checking",
      waitedMs,
      next: "The security check is still running. Do not reload or click it; call snapshot, which waits for it.",
    };
  if (detected) return { vendor: detected.vendor, status: "needs-user", waitedMs, next: NEEDS_USER_NEXT };
  if (clearedVendor)
    return {
      vendor: clearedVendor,
      status: "cleared",
      waitedMs,
      next: "The security check passed while OpenBot waited. Continue with this snapshot.",
    };
  return undefined;
}
