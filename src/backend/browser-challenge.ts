import type { BrowserChallenge } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Option } from "effect";
import type { WebContents } from "electron";
import {
  automationContextId,
  frameIds,
  isFiniteNumber,
  numberValue,
  recordValue,
  type SendCommand,
  stringValue,
} from "./browser-cdp-values";

/** How long a snapshot waits for a check that clears by itself, such as a Cloudflare interstitial. */
export const CHALLENGE_WAIT_MS = 15_000;

/** How often the snapshot reads the page again while it waits. */
export const CHALLENGE_POLL_MS = 1_000;

/** How long the read after a checkbox offer waits for the check to pass. */
export const CHALLENGE_CLICK_WAIT_MS = 6_000;

/**
 * How long the first read of a document waits for a Turnstile widget to pass by itself before it
 * offers the checkbox. Most widgets pass without a click in 1 to 2 seconds, and a click before that
 * can look like a bot to the site.
 */
export const TURNSTILE_SELF_PASS_MS = 3_000;

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
  /** The viewport point of a checkbox widget that one click can pass, such as Turnstile. */
  checkbox: { x: number; y: number } | null;
  /** An image puzzle shows. Only a person solves it. */
  puzzle: boolean;
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
  // A widget whose response field has a token passed: the page can submit its form.
  const filled = (selector) => [...document.querySelectorAll(selector)].some((element) => (element.value || "").length > 0);
  const turnstilePassed = filled("input[name='cf-turnstile-response']");
  const recaptchaPassed = filled("textarea[name='g-recaptcha-response']");
  const hcaptchaPassed = filled("textarea[name='h-captcha-response']");
  // An image puzzle needs a person. A click on its checkbox does nothing more.
  const puzzle = [...document.querySelectorAll("iframe")].some((element) => {
    if (!/\/recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com.*frame=challenge/.test(element.src || "")) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 100 && rect.height > 100 && getComputedStyle(element).visibility !== "hidden";
  });
  // The checkbox of a Turnstile, reCAPTCHA or hCaptcha widget of the normal size, which is 28 px from
  // the widget's left edge and in its middle. A widget outside the viewport gives none.
  const checkbox = (() => {
    if (puzzle) return null;
    const widgets = [...document.querySelectorAll("iframe")].filter((element) => {
      const source = element.src || "";
      return (
        (!turnstilePassed && /challenges\.cloudflare\.com/.test(source)) ||
        (!recaptchaPassed && /\/recaptcha\/(api2|enterprise)\/anchor/.test(source) && !/size=invisible/.test(source)) ||
        (!hcaptchaPassed && /hcaptcha\.com.*frame=checkbox/.test(source))
      );
    });
    for (const widget of widgets) {
      const rect = widget.getBoundingClientRect();
      if (rect.width < 200 || rect.width > 420 || rect.height < 50 || rect.height > 100) continue;
      if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) continue;
      return { x: Math.round(rect.left + 28), y: Math.round(rect.top + rect.height / 2) };
    }
    return null;
  })();
  // Turnstile puts its frame in a closed shadow root, which this world cannot see. A Turnstile field
  // without a token asks the main process to find the frame through CDP.
  const turnstileField = !turnstilePassed && checkbox === null && has("input[name='cf-turnstile-response']");
  const viewport = { width: innerWidth, height: innerHeight };
  const found = (vendor, kind, signal) =>
    kind === "block"
      ? { vendor, kind, signal, checkbox: null, puzzle, turnstileField: false, viewport }
      : { vendor, kind, signal, checkbox, puzzle, turnstileField, viewport };

  if ((has("#cf-error-details") || has(".cf-error-code")) && /blocked|error 10(0[0-9]|20)|access denied/i.test(text))
    return found("cloudflare", "block", "cloudflare-error-page");
  // Ordinary pages use ids such as "challenge-form" too, so a Cloudflare id counts only with a
  // Cloudflare script or frame, or on a short page.
  const cloudflare = frame(/challenges\.cloudflare\.com/) || has("script[src*='/cdn-cgi/challenge-platform/']");
  if ((cloudflare || short) && has("#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running, .cf-browser-verification, #cf-please-wait"))
    return found("cloudflare", "non-interactive", "cloudflare-challenge-markup");
  // The interstitial of a site can load a consent banner, which makes the page long. Its own script
  // still identifies it.
  const challengePage = has("script[src*='/cdn-cgi/challenge-platform/'][src*='/orchestrate/chl_page/']");
  if ((/^(just a moment|attention required)/i.test(title) && (short || challengePage)) || (/^one more step/i.test(title) && cloudflare))
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
  if (!turnstilePassed && frame(/challenges\.cloudflare\.com/)) return found("turnstile", "interactive", "turnstile-frame");
  // The main process keeps this only when it finds a visible Turnstile frame: a widget in invisible
  // mode has a field too.
  if (turnstileField) return found("turnstile", "interactive", "turnstile-field");
  if (!hcaptchaPassed && frame(/hcaptcha\.com/)) return found("hcaptcha", "interactive", "hcaptcha-frame");
  if (!recaptchaPassed && frame(/\/recaptcha\/(api2|enterprise)\/|recaptcha\.net/))
    return found("recaptcha", "interactive", "recaptcha-frame");
  if (/you have been blocked|your request (has been|was) blocked|request blocked/i.test(text) || /^(access denied|403 forbidden)/i.test(title))
    return found("generic", "block", "block-text");
  if (/checking (if the site connection is secure|your browser)|verifying you are human|please wait while we (verify|check)/i.test(text))
    return found("generic", "non-interactive", "wait-text");
  // The page keeps its text after its widget passed.
  if (turnstilePassed || recaptchaPassed || hcaptchaPassed) return null;
  if (/verify (that )?you are (a )?human|are you a robot|press (and|&) hold|complete the security check|unusual traffic from your (computer|network)/i.test(text))
    return found("generic", "interactive", "captcha-text");
  return null;
})()`;

function challengeKind(value: unknown): DetectedChallenge["kind"] | null {
  return value === "non-interactive" || value === "interactive" || value === "block" ? value : null;
}

function readCheckbox(value: unknown): DetectedChallenge["checkbox"] {
  if (!isDynamicRecord(value)) return null;
  const { x, y } = value;
  return typeof x === "number" && typeof y === "number" && x >= 0 && y >= 0 ? { x, y } : null;
}

function readChallenge(value: unknown): DetectedChallenge | null {
  if (!isDynamicRecord(value)) return null;
  const kind = challengeKind(value.kind);
  if (!kind || !isString(value.vendor) || !isString(value.signal)) return null;
  return {
    vendor: value.vendor,
    kind,
    signal: value.signal,
    checkbox: readCheckbox(value.checkbox),
    puzzle: value.puzzle === true,
  };
}

/** The most frames that the Turnstile lookup reads. A page with a check has few. */
const MAX_WIDGET_FRAMES = 12;

interface FrameBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The box of a visible Turnstile frame in the main document, in viewport CSS pixels. CDP names a
 * frame's owner also inside a closed shadow root. A frame in another process is a child target.
 */
const turnstileFrameBox = Effect.fn("Browser.turnstileFrameBox")(function* (
  send: SendCommand,
  childFrameIds: readonly string[],
) {
  // The first frame of the tree is the page itself.
  const local = frameIds(yield* send("Page.getFrameTree", {})).slice(1);
  for (const frameId of [...new Set([...local, ...childFrameIds])].slice(0, MAX_WIDGET_FRAMES)) {
    const box = yield* Effect.gen(function* () {
      const owner = numberValue((yield* send("DOM.getFrameOwner", { frameId })).backendNodeId);
      if (!owner) return null;
      const node = recordValue((yield* send("DOM.describeNode", { backendNodeId: owner })).node);
      const attributes = Array.isArray(node?.attributes) ? node.attributes.map(stringValue) : [];
      const source = attributes.find((_, index) => index % 2 === 1 && attributes[index - 1] === "src") ?? "";
      if (!/challenges\.cloudflare\.com/.test(source)) return null;
      const quad = recordValue((yield* send("DOM.getBoxModel", { backendNodeId: owner })).model)?.border;
      const corners = Array.isArray(quad) ? quad.filter(isFiniteNumber).slice(0, 8) : [];
      if (corners.length < 8) return null;
      const xs = corners.filter((_, index) => index % 2 === 0);
      const ys = corners.filter((_, index) => index % 2 === 1);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    // A detached frame or a hidden widget has no box.
    if (box && box.width > 20 && box.height > 20) return box;
  }
  return null;
});

/** The checkbox of a normal-size widget, 28 px from its left edge and in its middle, as the page script finds it. */
function widgetCheckbox(box: FrameBox, viewport: unknown): DetectedChallenge["checkbox"] {
  const size = recordValue(viewport);
  const width = numberValue(size?.width);
  const height = numberValue(size?.height);
  if (box.width < 200 || box.width > 420 || box.height < 50 || box.height > 100) return null;
  if (box.left < 0 || box.top < 0 || box.left + box.width > width || box.top + box.height > height) return null;
  return { x: Math.round(box.left + 28), y: Math.round(box.top + box.height / 2) };
}

/**
 * Reads the main frame for a bot check in the isolated automation world, so the page cannot change
 * what it reads. It uses CDP like the snapshot: on Linux, `executeJavaScriptInIsolatedWorld` does not
 * return for a document whose navigation was stopped. A failure or a non-web page gives `null`.
 * `childFrameIds` names the frames in other processes, where a Turnstile widget usually is.
 */
export const detectChallenge = Effect.fn("Browser.detectChallenge")(function* (
  contents: WebContents,
  send: SendCommand,
  childFrameIds: readonly string[] = [],
) {
  if (contents.isDestroyed()) return null;
  const url = contents.getURL();
  if (!url.startsWith("https://") && !url.startsWith("http://")) return null;
  return yield* Effect.gen(function* () {
    const contextId = yield* automationContextId(send);
    const result = yield* send("Runtime.evaluate", { expression: CHALLENGE_SCRIPT, contextId, returnByValue: true });
    const value = isDynamicRecord(result.result) ? result.result.value : undefined;
    const detected = readChallenge(value);
    if (!detected || !isDynamicRecord(value) || value.turnstileField !== true || detected.puzzle) return detected;
    const box = yield* turnstileFrameBox(send, childFrameIds);
    // A Turnstile field alone is no check: a widget in invisible mode passes by itself.
    if (!box) return detected.signal === "turnstile-field" ? null : detected;
    return { ...detected, checkbox: widgetCheckbox(box, value.viewport) };
  }).pipe(
    Effect.timeoutOption(CHECK_TIMEOUT_MS),
    Effect.map((option) => Option.getOrNull(option)),
    Effect.catch(() => Effect.succeed(null)),
  );
});

const NEEDS_USER_NEXT =
  "A person must pass this security check. Do not reload, click, or try to solve it. Call request_takeover so the user solves it; in a routine run, report it.";

/** The line that the model reads in the snapshot. */
export function describeChallenge(
  detected: DetectedChallenge | null,
  clearedVendor: string | null,
  waitedMs: number,
  /** The check passes by itself, and its wait has time left for the next read. */
  checking = false,
  /** The checkbox that the agent may click once. Only the first read of a document offers it. */
  clickOnce: DetectedChallenge["checkbox"] = null,
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
  if (detected && clickOnce)
    return {
      vendor: detected.vendor,
      status: "click-once",
      waitedMs,
      target: { kind: "point", x: clickOnce.x, y: clickOnce.y },
      next: "This check can pass with one click on its checkbox. Call click with target, then call snapshot, which waits for the check. Click it only once, and do not reload or solve a puzzle. If the check stays, call request_takeover so the user solves it; in a routine run, report it.",
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
