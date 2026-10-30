import { randomUUID } from "node:crypto";
import {
  type BrowserSignInCookie,
  browserSignInCookieFitsHost,
} from "@openbot/contracts/team-protocol/browser-sign-in-v1";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Exit, Schema } from "effect";
import {
  BrowserWindow,
  type Cookie,
  session as electronSession,
  type Session,
  type WebContents,
  type WebPreferences,
} from "electron";
import { sessionBrowserUserAgent } from "../backend/browser-identity";
import {
  browserRequestHeaders,
  isAllowedBrowserPermission,
  normalizeBrowserUrl,
  preferredBrowserLanguageCodes,
} from "../backend/browser-policy";
import { isBrowserSignInAddress, isBrowserSignInSite } from "./browser-sign-in-page";

/**
 * A window on this computer where a person signs in to a site for a tab of a remote server's browser.
 * Some sites refuse a sign-in from a server address, but accept the session that this computer makes.
 *
 * Each sign-in has its own session in memory, so the page cannot read the app's cookies or storage,
 * and nothing stays on disk. The page has the sandbox of the embedded browser. It cannot download a
 * file, ask for a permission other than a clipboard write, or leave http(s). A site can open a popup,
 * for example a sign-in with another account; the popup has the same session and the same rules.
 *
 * The window sees when the sign-in is complete: the site showed a sign-in step, then set a cookie
 * that the page cannot read, then left the sign-in steps. This is a guess, so the caller sends the
 * session and checks the server tab before it closes the window.
 */

/** The bounds of the `browser-sign-in` wire. */
const COOKIE_LIMIT = 150;
const COOKIE_TEXT_LIMIT = 4096;
const COOKIE_DOMAIN_LIMIT = 253;
const COOKIE_PATH_LIMIT = 1024;
/** Cloudflare ties these cookies to the address that passed its check, so the server cannot use them. */
const ADDRESS_BOUND_COOKIE = /^(?:__cf|cf_)/u;
const WINDOW_WIDTH = 520;
const WINDOW_HEIGHT = 760;
/** A site changes the page and its cookies in several steps. The check runs when they stop. */
const CHECK_DELAY_MS = 1_000;
const SCRIPT_WORLD = 1_018;
const PASSWORD_FIELD_SCRIPT = `Array.from(document.querySelectorAll("input[type=password]")).some((field) => field.getClientRects().length > 0)`;

export class LocalSignInFailed extends Schema.TaggedError<LocalSignInFailed>()("LocalSignInFailed", {
  cause: Schema.Defect(),
}) {}

/** The tab that a sign-in is for. The server is the one that was active when the window opened. */
export interface LocalSignInTarget {
  serverId: string;
  tabId: string;
}

/** How the wait for a window ends: the person closed it, or the site looks signed in. */
export type LocalSignInEnd = "closed" | "signed-in";

interface PendingSignIn extends LocalSignInTarget {
  host: string;
  session: Session;
  window: BrowserWindow | null;
  ended: Deferred.Deferred<LocalSignInEnd>;
  signInSeen: boolean;
  cookieAfterSignIn: boolean;
  check: ReturnType<typeof setTimeout> | null;
}

function isWebUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

function signInCookie(cookie: Cookie): BrowserSignInCookie | null {
  const domain = cookie.domain ?? "";
  const path = cookie.path ?? "/";
  if (ADDRESS_BOUND_COOKIE.test(cookie.name)) return null;
  if (cookie.name.length + cookie.value.length > COOKIE_TEXT_LIMIT) return null;
  if (domain.length > COOKIE_DOMAIN_LIMIT || path.length > COOKIE_PATH_LIMIT) return null;
  const bare = domain.replace(/^\./u, "");
  return {
    name: cookie.name,
    value: cookie.value,
    // The wire marks a cookie for one host by a domain with no leading dot.
    domain: cookie.hostOnly ? bare : `.${bare}`,
    path,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: cookie.sameSite,
    expirationDate:
      cookie.session || cookie.expirationDate === undefined ? null : Math.max(0, Math.floor(cookie.expirationDate)),
  };
}

export class LocalSignInWindows {
  #pending: PendingSignIn | null = null;

  /** The tab of the open sign-in and the host of its site, or null. */
  target(): (LocalSignInTarget & { host: string }) | null {
    const pending = this.#pending;
    return pending ? { serverId: pending.serverId, tabId: pending.tabId, host: pending.host } : null;
  }

  /** The address of the page in the sign-in window, or null when no window is open. */
  page(): string | null {
    const contents = this.#pending?.window?.webContents;
    return contents && !contents.isDestroyed() ? contents.getURL() : null;
  }

  /** True when the window of the open sign-in showed a sign-in step. */
  signInSeen(): boolean {
    return this.#pending?.signInSeen === true;
  }

  /**
   * Opens the address in a sign-in window, or shows the window that is open for the same tab. The
   * effect ends when the window closes or the site looks signed in. The session stays until
   * `discard`, so a person can close the window and then select Done.
   */
  readonly open = Effect.fn("LocalSignInWindows.open")(function* (
    this: LocalSignInWindows,
    target: LocalSignInTarget,
    address: string,
  ): Effect.fn.Return<LocalSignInEnd, LocalSignInFailed> {
    const url = yield* Effect.try({
      try: () => normalizeBrowserUrl(address),
      catch: (cause) => new LocalSignInFailed({ cause }),
    });
    const pending = this.#pending;
    if (pending && (pending.serverId !== target.serverId || pending.tabId !== target.tabId)) yield* this.discard();
    const current = this.#pending ?? this.#start(target, new URL(url).hostname);
    if (Deferred.isDoneUnsafe(current.ended)) current.ended = Deferred.makeUnsafe<LocalSignInEnd>();
    if (current.window && !current.window.isDestroyed()) {
      current.window.show();
      current.window.focus();
    } else {
      yield* Effect.try({
        try: () => this.#openWindow(current, url),
        catch: () => new LocalSignInFailed({ cause: new Error(sourceText("error.backend.browserSignInOpenFailed")) }),
      });
    }
    return yield* Deferred.await(current.ended);
  });

  /** The cookies of the tab's site in the sign-in session. The values never go to a log. */
  readonly collect = Effect.fn("LocalSignInWindows.collect")(function* (
    this: LocalSignInWindows,
  ): Effect.fn.Return<BrowserSignInCookie[], LocalSignInFailed> {
    const pending = this.#pending;
    if (!pending) return [];
    const cookies = yield* Effect.tryPromise({
      try: () => pending.session.cookies.get({}),
      catch: () => new LocalSignInFailed({ cause: new Error(sourceText("error.backend.browserSignInReadFailed")) }),
    });
    return cookies
      .filter((cookie) => browserSignInCookieFitsHost(cookie.domain ?? "", pending.host))
      .flatMap((cookie) => signInCookie(cookie) ?? [])
      .slice(0, COOKIE_LIMIT);
  });

  /** Closes the window and removes everything that the sign-in kept. */
  readonly discard = Effect.fn("LocalSignInWindows.discard")(function* (this: LocalSignInWindows) {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    if (pending.check) clearTimeout(pending.check);
    // The popups that the site opened have the same session.
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed() && window.webContents.session === pending.session) window.destroy();
    yield* Deferred.done(pending.ended, Exit.succeed("closed"));
    yield* Effect.tryPromise(() => pending.session.clearStorageData()).pipe(Effect.ignore);
  });

  #start(target: LocalSignInTarget, host: string): PendingSignIn {
    const session = electronSession.fromPartition(`openbot-sign-in-${randomUUID()}`, { cache: false });
    session.setUserAgent(sessionBrowserUserAgent(session.getUserAgent()), preferredBrowserLanguageCodes());
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({ requestHeaders: browserRequestHeaders(details.url, details.requestHeaders) });
    });
    session.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(isAllowedBrowserPermission(permission)),
    );
    session.setPermissionCheckHandler((_contents, permission) => isAllowedBrowserPermission(permission));
    session.on("will-download", (event) => event.preventDefault());
    const pending: PendingSignIn = {
      ...target,
      host,
      session,
      window: null,
      ended: Deferred.makeUnsafe<LocalSignInEnd>(),
      signInSeen: false,
      cookieAfterSignIn: false,
      check: null,
    };
    // Sites keep the session in a cookie that the page cannot read.
    session.cookies.on("changed", (_event, cookie, _cause, removed) => {
      if (removed || !cookie.httpOnly || !pending.signInSeen) return;
      if (!browserSignInCookieFitsHost(cookie.domain ?? "", host)) return;
      pending.cookieAfterSignIn = true;
      this.#scheduleCheck(pending);
    });
    this.#pending = pending;
    return pending;
  }

  #scheduleCheck(pending: PendingSignIn): void {
    if (pending.check) clearTimeout(pending.check);
    pending.check = setTimeout(() => {
      pending.check = null;
      void this.#check(pending);
    }, CHECK_DELAY_MS);
  }

  async #check(pending: PendingSignIn): Promise<void> {
    const contents = pending.window?.webContents;
    if (this.#pending !== pending || !contents || contents.isDestroyed()) return;
    const url = contents.getURL();
    // A sign-in with another account opens on that site, in a popup or in this window.
    if (!isBrowserSignInSite(url, pending.host)) return;
    const passwordField = await contents
      .executeJavaScriptInIsolatedWorld(SCRIPT_WORLD, [{ code: PASSWORD_FIELD_SCRIPT }])
      .then((result: unknown) => result === true)
      .catch(() => false);
    if (this.#pending !== pending || contents.isDestroyed() || contents.getURL() !== url) return;
    if (passwordField || isBrowserSignInAddress(url)) {
      pending.signInSeen = true;
      return;
    }
    if (!pending.signInSeen || !pending.cookieAfterSignIn) return;
    // A new cookie must come before the next end, so a page that the server refused does not end the wait again.
    pending.cookieAfterSignIn = false;
    Deferred.doneUnsafe(pending.ended, Exit.succeed("signed-in"));
  }

  #openWindow(pending: PendingSignIn, url: string): void {
    const webPreferences: WebPreferences = {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: pending.session,
    };
    const window = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      autoHideMenuBar: true,
      webPreferences,
    });
    pending.window = window;
    window.on("closed", () => {
      if (pending.window !== window) return;
      pending.window = null;
      Deferred.doneUnsafe(pending.ended, Exit.succeed("closed"));
    });
    const contents = window.webContents;
    contents.on("did-navigate", () => this.#scheduleCheck(pending));
    contents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (isMainFrame) this.#scheduleCheck(pending);
    });
    contents.on("did-stop-loading", () => this.#scheduleCheck(pending));
    this.#guard(contents, webPreferences);
    void window.loadURL(url).catch(() => undefined);
  }

  #guard(contents: WebContents, webPreferences: WebPreferences): void {
    contents.on("will-navigate", (event) => {
      if (!isWebUrl(event.url)) event.preventDefault();
    });
    contents.on("will-redirect", (event) => {
      if (!isWebUrl(event.url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) =>
      isWebUrl(url)
        ? { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences } }
        : { action: "deny" },
    );
    contents.on("did-create-window", (child) => this.#guard(child.webContents, webPreferences));
  }
}
