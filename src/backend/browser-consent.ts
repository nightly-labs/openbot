import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { WebContents } from "electron";

/** The isolated world of the consent script. The page cannot read its state or its functions. */
export const CONSENT_WORLD = 1_019;

/** How long a document can show its banner after `dom-ready`. After this, the script stops watching. */
const WATCH_MS = 15_000;

const logger = createOpenBotLogger("browser-consent");

/** The buttons of common consent platforms that refuse all optional cookies in one click. */
const REJECT_SELECTORS = [
  "#onetrust-reject-all-handler",
  "#CybotCookiebotDialogBodyButtonDecline",
  "#didomi-notice-disagree-button",
  ".cky-btn-reject",
  ".cmplz-btn.cmplz-deny",
  ".osano-cm-denyAll",
  ".iubenda-cs-reject-btn",
  "[data-testid='uc-deny-all-button']",
];

/**
 * The whole label of a button that refuses optional cookies, after lower case and with punctuation
 * changed to spaces. A label that accepts all cookies never matches.
 */
const REJECT_LABEL = new RegExp(
  `^(?:${[
    "(?:reject|decline|deny|refuse|disagree)(?: all)?(?: (?:optional |non essential |additional )?cookies)?",
    "(?:i )?do not (?:accept|agree)",
    "(?:use |allow |accept )?(?:strictly )?(?:necessary|essential|required) (?:cookies )?only",
    "(?:use |allow |accept )?only (?:strictly )?(?:necessary|essential|required)(?: cookies)?",
    "continue without (?:accepting|agreeing|consent)",
    "(?:alle )?(?:cookies )?ablehnen",
    "nur (?:notwendige|essenzielle|erforderliche)(?: cookies)?(?: (?:akzeptieren|zulassen|erlauben|verwenden))?",
    "(?:tout )?refuser(?: tout)?",
    "continuer sans accepter",
    "rechazar(?: todo| todas)?(?: las cookies)?",
    "rifiuta(?: tutto| tutti)?",
    "odrzuć(?: wszystkie)?",
    "(?:alles )?weigeren",
    "rejeitar(?: tudo| todos)?",
  ].join("|")})$`,
  "u",
);

/**
 * Text that a cookie banner shows. Banners in these languages use the word "cookie". Words such as
 * "consent" also show on sign-in and terms dialogs, where a "Decline" button must stay.
 */
const COOKIE_TEXT = /cookie|ciasteczk/iu;

/** An id or class of a consent container. */
const CONSENT_NAME = /cookie|consent|gdpr|cmp/iu;

/**
 * Runs once in each document. It clicks one reject button and stops, or stops after `WATCH_MS`. A
 * button counts only when it is visible, its whole label refuses cookies, and it is in a banner: an
 * ancestor shows cookie text, and an ancestor is a dialog, fixed or sticky, or has a consent name.
 */
const CONSENT_SCRIPT = String.raw`(() => {
  if (globalThis.__openbotConsent) return;
  globalThis.__openbotConsent = true;
  const selectors = ${JSON.stringify(REJECT_SELECTORS)};
  const rejectLabel = new RegExp(${JSON.stringify(REJECT_LABEL.source)}, "u");
  const cookieText = new RegExp(${JSON.stringify(COOKIE_TEXT.source)}, "iu");
  const consentName = new RegExp(${JSON.stringify(CONSENT_NAME.source)}, "iu");
  const candidates = "button, [role=button], input[type=button], input[type=submit], a";
  let done = false;
  let timer = 0;
  const watched = new WeakSet();

  const roots = () => {
    const found = [document];
    for (let index = 0; index < found.length && index < 50; index++) {
      for (const element of found[index].querySelectorAll("*")) if (element.shadowRoot) found.push(element.shadowRoot);
    }
    return found;
  };
  const visible = (element) => {
    if (element.getClientRects().length === 0 || element.disabled) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const label = (element) =>
    (element.getAttribute("aria-label") || element.innerText || element.value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const safeLink = (element) => {
    if (element.tagName !== "A") return true;
    const href = element.getAttribute("href");
    return !href || href.startsWith("#") || href.startsWith("javascript:");
  };
  // innerText leaves out the text of shadow roots, so a banner made of web components shows none.
  const deepText = (node, depth) => {
    let content = node.nodeType === Node.ELEMENT_NODE ? node.innerText || "" : "";
    if (node.nodeType !== Node.ELEMENT_NODE)
      for (const child of node.children) if (child.tagName !== "STYLE" && child.tagName !== "SCRIPT") content += " " + (child.innerText || "");
    if (depth >= 5) return content;
    if (node.shadowRoot) content += " " + deepText(node.shadowRoot, depth + 1);
    for (const element of node.querySelectorAll("*")) {
      if (content.length >= 5000) break;
      if (element.shadowRoot) content += " " + deepText(element.shadowRoot, depth + 1);
    }
    return content;
  };
  const inBanner = (element) => {
    let text = false;
    let container = false;
    let node = element;
    for (let depth = 0; node && node !== document.body && node !== document.documentElement && depth < 15; depth++) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const content = text ? "" : deepText(node, 0);
        if (!text && content.length < 5000 && cookieText.test(content)) text = true;
        const role = node.getAttribute("role");
        const position = getComputedStyle(node).position;
        if (
          node.tagName === "DIALOG" ||
          role === "dialog" ||
          role === "alertdialog" ||
          node.getAttribute("aria-modal") === "true" ||
          position === "fixed" ||
          position === "sticky" ||
          consentName.test(node.id) ||
          consentName.test(node.getAttribute("class") || "")
        )
          container = true;
        if (text && container) return true;
      }
      node = node.parentElement || node.getRootNode().host;
    }
    return false;
  };
  const find = (all) => {
    for (const root of all) {
      for (const selector of selectors) {
        const element = root.querySelector(selector);
        if (element && visible(element)) return element;
      }
    }
    for (const root of all) {
      for (const element of root.querySelectorAll(candidates)) {
        const text = label(element);
        if (text.length > 0 && text.length <= 60 && rejectLabel.test(text) && safeLink(element) && visible(element) && inBanner(element))
          return element;
      }
    }
    return null;
  };
  const observer = new MutationObserver(() => {
    if (!done && !timer) timer = setTimeout(scan, 250);
  });
  const options = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "open"],
  };
  // A subtree observer does not see into shadow roots, and a platform can fill its root later.
  const watch = (all) => {
    for (const root of all) {
      if (watched.has(root)) continue;
      watched.add(root);
      observer.observe(root === document ? document.documentElement : root, options);
    }
  };
  const stop = () => {
    done = true;
    globalThis.__openbotConsent = "stopped";
    clearTimeout(timer);
    observer.disconnect();
  };
  globalThis.__openbotConsentStop = stop;
  function scan() {
    timer = 0;
    if (done) return;
    const all = roots();
    watch(all);
    const target = find(all);
    if (!target) return;
    stop();
    target.click();
  }
  setTimeout(stop, ${WATCH_MS});
  scan();
})();`;

/**
 * Refuses the cookie banner of the main frame. Call it once per document, on `dom-ready`. It never
 * accepts: when a banner has no reject button, it stays.
 */
export function refuseCookieBanners(contents: WebContents): void {
  const url = contents.getURL();
  if (!url.startsWith("https://") && !url.startsWith("http://")) return;
  // A navigation during the run also rejects it, so this is a debug note and not a warning.
  void contents
    .executeJavaScriptInIsolatedWorld(CONSENT_WORLD, [{ code: CONSENT_SCRIPT }])
    .catch((error: unknown) => logger.debug("Cookie banner script stopped", { error: toLogValue(error) }));
}

/** Stops the script of the current document, when a person or a secret entry takes the tab. */
export function stopCookieBanners(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  void contents
    .executeJavaScriptInIsolatedWorld(CONSENT_WORLD, [{ code: "globalThis.__openbotConsentStop?.()" }])
    .catch(() => undefined);
}
