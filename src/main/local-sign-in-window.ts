import { randomUUID } from "node:crypto";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  BROWSER_SIGN_IN_STORAGE_ENTRY_LIMIT,
  BROWSER_SIGN_IN_STORAGE_TEXT_LIMIT,
  type BrowserSignInStorage,
  isBrowserSignInOrigin,
} from "@openbot/contracts/team-protocol/browser-sign-in-storage-v1";
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

const COOKIE_LIMIT = 150;
const COOKIE_TEXT_LIMIT = 4096;
const COOKIE_DOMAIN_LIMIT = 253;
const COOKIE_PATH_LIMIT = 1024;
const ADDRESS_BOUND_COOKIE = /^(?:__cf|cf_)/u;
const WINDOW_WIDTH = 520;
const WINDOW_HEIGHT = 760;
const CHECK_DELAY_MS = 1_000;
const SCRIPT_WORLD = 1_018;
const PASSWORD_FIELD_SCRIPT = `Array.from(document.querySelectorAll("input[type=password]")).some((field) => field.getClientRects().length > 0)`;
const STORAGE_SCRIPT = `({ origin: location.origin, entries: Object.keys(localStorage).map((name) => ({ name, value: localStorage.getItem(name) ?? "" })) })`;
const STORAGE_READ_TIMEOUT_MS = 2_000;
const ERR_ABORTED = -3;

export class LocalSignInFailed extends Schema.TaggedError<LocalSignInFailed>()("LocalSignInFailed", {
  cause: Schema.Defect(),
}) {}

export interface LocalSignInTarget {
  serverId: string;
  tabId: string;
}

export type LocalSignInEnd = "closed" | "signed-in";

interface PendingSignIn extends LocalSignInTarget {
  host: string;
  session: Session;
  window: BrowserWindow | null;
  ended: Deferred.Deferred<LocalSignInEnd, LocalSignInFailed>;
  signInSeen: boolean;
  cookieAfterSignIn: boolean;
  check: ReturnType<typeof setTimeout> | null;
  storage: BrowserSignInStorage | null;
  storageReads: number;
  storageRead: number;
}

function isWebUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

function signInStorage(value: unknown): BrowserSignInStorage | null {
  if (!isDynamicRecord(value) || !isString(value.origin) || !isBrowserSignInOrigin(value.origin)) return null;
  if (!Array.isArray(value.entries)) return null;
  const entries: BrowserSignInStorage["entries"] = [];
  let text = 0;
  for (const item of value.entries) {
    if (!isDynamicRecord(item) || !isString(item.name) || !isString(item.value)) continue;
    const size = Buffer.byteLength(JSON.stringify(item.name) + JSON.stringify(item.value));
    if (entries.length >= BROWSER_SIGN_IN_STORAGE_ENTRY_LIMIT || text + size > BROWSER_SIGN_IN_STORAGE_TEXT_LIMIT)
      continue;
    text += size;
    entries.push({ name: item.name, value: item.value });
  }
  return { origin: value.origin, entries };
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

  target(): (LocalSignInTarget & { host: string }) | null {
    const pending = this.#pending;
    return pending ? { serverId: pending.serverId, tabId: pending.tabId, host: pending.host } : null;
  }

  page(): string | null {
    const contents = this.#pending?.window?.webContents;
    return contents && !contents.isDestroyed() ? contents.getURL() : null;
  }

  signInSeen(): boolean {
    return this.#pending?.signInSeen === true;
  }

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
    if (Deferred.isDoneUnsafe(current.ended)) current.ended = Deferred.makeUnsafe<LocalSignInEnd, LocalSignInFailed>();
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

  readonly collectStorage = Effect.fn("LocalSignInWindows.collectStorage")(function* (this: LocalSignInWindows) {
    const pending = this.#pending;
    if (!pending) return null;
    return yield* Effect.promise(() => this.#readStorage(pending));
  });

  readonly discard = Effect.fn("LocalSignInWindows.discard")(function* (this: LocalSignInWindows) {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    if (pending.check) clearTimeout(pending.check);
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
      ended: Deferred.makeUnsafe<LocalSignInEnd, LocalSignInFailed>(),
      signInSeen: false,
      cookieAfterSignIn: false,
      check: null,
      storage: null,
      storageReads: 0,
      storageRead: 0,
    };
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
    if (!isBrowserSignInSite(url, pending.host)) return;
    void this.#readStorage(pending);
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
    pending.cookieAfterSignIn = false;
    Deferred.doneUnsafe(pending.ended, Exit.succeed("signed-in"));
  }

  async #readStorage(pending: PendingSignIn): Promise<BrowserSignInStorage | null> {
    const contents = pending.window?.webContents;
    if (!contents || contents.isDestroyed() || !URL.canParse(contents.getURL())) return pending.storage;
    if (new URL(contents.getURL()).hostname !== pending.host) return pending.storage;
    pending.storageReads += 1;
    const read = pending.storageReads;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      contents.executeJavaScriptInIsolatedWorld(SCRIPT_WORLD, [{ code: STORAGE_SCRIPT }]).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), STORAGE_READ_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    const storage = signInStorage(result);
    if (storage && this.#pending === pending && read > pending.storageRead) {
      pending.storage = storage;
      pending.storageRead = read;
    }
    return pending.storage;
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
    contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED) this.#fail(pending, window);
    });
    contents.on("render-process-gone", (_event, details) => {
      if (details.reason !== "clean-exit") this.#fail(pending, window);
    });
    this.#guard(contents, webPreferences);
    void window.loadURL(url).catch(() => undefined);
  }

  #fail(pending: PendingSignIn, window: BrowserWindow): void {
    if (this.#pending !== pending || pending.window !== window || Deferred.isDoneUnsafe(pending.ended)) return;
    const cause = new Error(sourceText("error.backend.browserSignInLoadFailed"));
    Deferred.doneUnsafe(pending.ended, Exit.fail(new LocalSignInFailed({ cause })));
    if (!window.isDestroyed()) window.destroy();
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
