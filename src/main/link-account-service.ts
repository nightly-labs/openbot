import type { LinkAccountState, LinkAccountStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import {
  createOpenBotLogger,
  redactText,
  registerSecretValue,
  registerSecretValues,
  toLogValue,
} from "@openbot/logging";
import { Duration, Effect, Exit, Result, Scope, Semaphore } from "effect";
import { z } from "zod";
import {
  LINK_CARD_ID_PREFIX,
  type LinkCard,
  type LinkPaymentRequest,
  type LinkPaymentResult,
  type LinkWallet,
  LinkWalletError,
} from "../backend/link-wallet";
import type { LinkAccountRecord, LinkAccountStore } from "./link-account-store";
import {
  isLinkPage,
  LINK_API_URL,
  LINK_REQUEST_TIMEOUT_MS,
  LinkAuthError,
  type LinkDeviceCode,
  type LinkFetch,
  type LinkTokenSet,
  pollLinkDeviceToken,
  refreshLinkToken,
  requestLinkDeviceCode,
  revokeLinkToken,
  unexpected,
  unreachable,
} from "./link-auth";
import { LinkOperationError, linkCall, linkDecode } from "./link-effects";

const logger = createOpenBotLogger("link-account");

const REFRESH_MARGIN_MS = 60_000;
const APPROVAL_POLL_MS = 2_000;
const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const WAITING_STATES = new Set(["created", "pending_approval"]);

const userInfoSchema = z.object({ email: z.string().nullish() });
const paymentDetailsSchema = z.object({
  payment_details: z.array(z.object({ id: z.string().min(1), is_default: z.boolean().nullish() })),
});
const spendRequestSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  approval_url: z.string().nullish(),
  merchant_url: z.string().nullish(),
});
const approvalLinkSchema = z.object({ approval_link: z.string() });
const cardSchema = z.object({
  number: z.string().regex(/^\d{12,19}$/u),
  cvc: z.string().nullish(),
  brand: z.string().nullish(),
  exp_month: z.coerce.number().int().min(1).max(12),
  exp_year: z.coerce.number().int(),
  valid_until: z.string().nullish(),
  billing_address: z.object({ name: z.string().nullish() }).nullish(),
});
const spendRequestWithCardSchema = spendRequestSchema.extend({ card: cardSchema.nullish() });

export interface LinkAccountServiceOptions {
  store: LinkAccountStore;
  openExternal: (url: string) => Promise<void>;
  fetch?: LinkFetch;
  now?: () => number;
}

interface PendingSignIn {
  controller: AbortController;
}

type LinkRequestBody = Readonly<Record<string, string | number | boolean>>;

interface LinkResponse {
  status: number;
  data: unknown;
}

export class LinkAccountService implements LinkWallet {
  readonly #store: LinkAccountStore;
  readonly #openExternal: (url: string) => Promise<void>;
  readonly #fetch: LinkFetch;
  readonly #now: () => number;
  readonly #scope = Scope.makeUnsafe();
  readonly #listeners = new Set<(status: LinkAccountStatus) => void>();
  #pending: PendingSignIn | null = null;
  #expired = false;
  #error: string | null = null;
  #generation = 0;
  #disposed = false;
  readonly #queue = Semaphore.makeUnsafe(1);
  readonly #refreshQueue = Semaphore.makeUnsafe(1);

  constructor(options: LinkAccountServiceOptions) {
    this.#store = options.store;
    this.#openExternal = options.openExternal;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#now = options.now ?? Date.now;
  }

  readonly load = Effect.fn("LinkAccount.load")(function* (this: LinkAccountService) {
    const error = yield* this.#store.load();
    if (error) logger.warn("The Link account file could not be read.", { cause: toLogValue(error) });
    const record = this.#store.read();
    if (!record) return;
    registerTokenSecrets(record);
    this.#expired = record.refreshToken === null && this.#accessTokenExpired(record);
  }).bind(this);

  status(): LinkAccountStatus {
    return { state: this.#state(), email: this.#store.read()?.email ?? null, error: this.#error };
  }

  onChanged(listener: (status: LinkAccountStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  connected(): boolean {
    return this.#store.read() !== null && !this.#expired;
  }

  readonly connect = Effect.fn("LinkAccount.connect")(function* (
    this: LinkAccountService,
  ): Effect.fn.Return<LinkAccountStatus> {
    if (this.#disposed) return this.status();
    this.#pending?.controller.abort();
    const pending: PendingSignIn = { controller: new AbortController() };
    this.#pending = pending;
    this.#error = null;
    this.#emitStatus();
    const device = yield* requestLinkDeviceCode({
      fetch: this.#fetch,
      now: this.#now,
      signal: pending.controller.signal,
    }).pipe(Effect.result);
    if (Result.isFailure(device)) {
      if (this.#pending === pending && !pending.controller.signal.aborted) this.#fail(pending, device.failure.cause);
      return this.status();
    }
    if (this.#pending !== pending) return this.status();
    yield* Effect.forkIn(this.#open(device.success.verificationUrl), this.#scope);
    yield* Effect.forkIn(this.#finishSignIn(pending, device.success), this.#scope);
    return this.status();
  }).bind(this);

  cancel(): LinkAccountStatus {
    this.#pending?.controller.abort();
    this.#pending = null;
    this.#error = null;
    this.#emitStatus();
    return this.status();
  }

  readonly disconnect = Effect.fn("LinkAccount.disconnect")(function* (
    this: LinkAccountService,
  ): Effect.fn.Return<LinkAccountStatus, LinkOperationError> {
    this.#pending?.controller.abort();
    this.#pending = null;
    this.#generation += 1;
    const record = this.#store.read();
    yield* this.#serialize(() => this.#store.clear());
    this.#expired = false;
    this.#error = null;
    this.#emitStatus();
    const token = record?.refreshToken ?? record?.accessToken;
    if (token) {
      yield* Effect.forkIn(
        revokeLinkToken({ fetch: this.#fetch, token }).pipe(
          Effect.catch(({ cause }) =>
            Effect.sync(() => logger.warn("Link did not revoke the sign-in.", { cause: toLogValue(cause) })),
          ),
        ),
        this.#scope,
      );
    }
    return this.status();
  }).bind(this);

  readonly dispose = Effect.fn("LinkAccount.dispose")(function* (this: LinkAccountService) {
    this.#disposed = true;
    this.#pending?.controller.abort();
    this.#pending = null;
    this.#listeners.clear();
    yield* Scope.close(this.#scope, Exit.void);
  }).bind(this);

  readonly requestPayment = Effect.fn("LinkAccount.requestPayment")(
    function* (
      this: LinkAccountService,
      request: LinkPaymentRequest,
    ): Effect.fn.Return<LinkPaymentResult, LinkOperationError> {
      const methods = yield* this.#api("GET", "/payment-details");
      const listed = yield* parseAnswer(paymentDetailsSchema, methods, "payment-details");
      const method =
        listed.payment_details.find((candidate) => candidate.is_default) ?? listed.payment_details[0] ?? null;
      if (!method) return yield* new LinkOperationError({ cause: new Error(sourceText("error.connector.linkNoCard")) });
      const created = yield* this.#api("POST", "/spend_requests", {
        payment_details: method.id,
        credential_type: "card",
        amount: request.amount,
        ...(request.currency ? { currency: request.currency.toLowerCase() } : {}),
        context: request.context,
        merchant_name: request.merchantName,
        merchant_url: request.merchantUrl,
        request_approval: true,
      });
      let spend = yield* parseAnswer(spendRequestSchema, created, "spend request");
      let approvalUrl = spend.approval_url ?? null;
      if (!approvalUrl && WAITING_STATES.has(spend.status)) {
        const asked = yield* this.#api("POST", `/spend_requests/${encodeURIComponent(spend.id)}/request_approval`);
        approvalUrl = (yield* parseAnswer(approvalLinkSchema, asked, "approval")).approval_link;
      }
      if (approvalUrl && isLinkPage(approvalUrl)) yield* Effect.forkIn(this.#open(approvalUrl), this.#scope);
      const deadline = this.#now() + APPROVAL_TIMEOUT_MS;
      while (WAITING_STATES.has(spend.status)) {
        if (this.#now() >= deadline)
          return { status: "expired", detail: "The user did not answer in Link within 5 minutes." };
        yield* Effect.sleep(Duration.millis(APPROVAL_POLL_MS));
        const read = yield* this.#api("GET", `/spend_requests/${encodeURIComponent(spend.id)}`).pipe(Effect.result);
        if (Result.isFailure(read)) {
          if (isUnreachable(read.failure)) continue;
          return yield* read.failure;
        }
        if (read.success.status >= 500) continue;
        spend = yield* parseAnswer(spendRequestSchema, read.success, "spend request");
      }
      if (spend.status !== "approved") {
        const status =
          spend.status === "denied" || spend.status === "expired" || spend.status === "requires_action"
            ? spend.status
            : "failed";
        return { status, detail: status === "failed" ? `Link answered ${spend.status}.` : null };
      }
      const cardId = `${LINK_CARD_ID_PREFIX}${spend.id}`;
      const card = yield* this.#readCard(spend.id);
      if (!card) return yield* new LinkOperationError({ cause: unexpected("card") });
      return {
        status: "approved",
        cardId,
        brand: card.brand,
        last4: card.secret.number.slice(-4),
        expMonth: card.secret.expMonth,
        expYear: card.secret.expYear,
        validUntil: card.validUntil,
      };
    },
    (operation) => operation.pipe(Effect.mapError(walletError)),
  ).bind(this);

  readonly card = Effect.fn("LinkAccount.card")(
    function* (this: LinkAccountService, cardId: string): Effect.fn.Return<LinkCard | null, LinkOperationError> {
      if (!cardId.startsWith(LINK_CARD_ID_PREFIX)) return null;
      const card = yield* this.#readCard(cardId.slice(LINK_CARD_ID_PREFIX.length));
      return card ? { secret: card.secret, merchantUrl: card.merchantUrl } : null;
    },
    (operation) => operation.pipe(Effect.mapError(walletError)),
  ).bind(this);

  readonly #readCard = Effect.fn("LinkAccount.readCard")(function* (this: LinkAccountService, id: string) {
    const read = yield* this.#api("GET", `/spend_requests/${encodeURIComponent(id)}?include=card`);
    if (read.status === 404) return null;
    const spend = yield* parseAnswer(spendRequestWithCardSchema, read, "card");
    const card = spend.card;
    if (spend.status !== "approved" || !card) return null;
    registerSecretValues([
      card.number,
      card.number.replace(/(\d{4})(?=\d)/gu, "$1 "),
      card.number.replace(/(\d{4})(?=\d)/gu, "$1-"),
    ]);
    return {
      secret: {
        number: card.number,
        securityCode: card.cvc ?? "",
        expMonth: card.exp_month,
        expYear: card.exp_year,
        nameOnCard: card.billing_address?.name ?? "",
      },
      brand: card.brand ?? null,
      validUntil: card.valid_until ?? null,
      merchantUrl: spend.merchant_url ?? "",
    };
  });

  readonly #api = Effect.fn("LinkAccount.api")(function* (
    this: LinkAccountService,
    method: "GET" | "POST",
    path: string,
    body?: LinkRequestBody,
  ): Effect.fn.Return<LinkResponse, LinkOperationError> {
    let record = this.#store.read();
    if (!record || this.#expired)
      return yield* new LinkOperationError({ cause: new Error(sourceText("error.connector.linkNotConnected")) });
    if (!record.refreshToken && this.#accessTokenExpired(record)) return yield* this.#markExpired();
    if (this.#accessTokenExpired(record, REFRESH_MARGIN_MS) && record.refreshToken)
      record = yield* this.#refresh(record);
    const first = yield* this.#send(method, path, body, record.accessToken);
    if (first.status === 401 && !record.refreshToken) return yield* this.#markExpired();
    if (first.status !== 401 || !record.refreshToken) return first;
    record = yield* this.#refresh(record);
    return yield* this.#send(method, path, body, record.accessToken);
  });

  readonly #markExpired = Effect.fn("LinkAccount.markExpired")(function* (
    this: LinkAccountService,
  ): Effect.fn.Return<never, LinkOperationError> {
    const message = sourceText("error.connector.linkExpired");
    if (!this.#expired) {
      this.#expired = true;
      this.#error = message;
      this.#emitStatus();
    }
    return yield* new LinkOperationError({ cause: new Error(message) });
  });

  readonly #send = Effect.fn("LinkAccount.send")(function* (
    this: LinkAccountService,
    method: "GET" | "POST",
    path: string,
    body: LinkRequestBody | undefined,
    accessToken: string,
  ): Effect.fn.Return<LinkResponse, LinkOperationError> {
    const timeout = AbortSignal.timeout(LINK_REQUEST_TIMEOUT_MS);
    const response = yield* linkCall((signal) =>
      this.#fetch(`${LINK_API_URL}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.any([signal, timeout]),
      }),
    ).pipe(Effect.mapError(({ cause }) => new LinkOperationError({ cause: unreachable(cause) })));
    const text = yield* linkCall(() => response.text()).pipe(Effect.catch(() => Effect.succeed("")));
    const data = yield* linkDecode((): unknown => JSON.parse(text)).pipe(Effect.catch(() => Effect.succeed(null)));
    return { status: response.status, data };
  });

  readonly #refresh = Effect.fn("LinkAccount.refresh")(function* (
    this: LinkAccountService,
    stale: LinkAccountRecord,
  ): Effect.fn.Return<LinkAccountRecord, LinkOperationError> {
    const work = Effect.gen({ self: this }, function* () {
      const record = this.#store.read();
      if (!record || this.#expired)
        return yield* new LinkOperationError({ cause: new Error(sourceText("error.connector.linkNotConnected")) });
      if (record.accessToken !== stale.accessToken) return record;
      const refreshToken = record.refreshToken;
      if (!refreshToken)
        return yield* new LinkOperationError({ cause: new Error(sourceText("error.connector.linkExpired")) });
      const generation = this.#generation;
      const tokens = yield* refreshLinkToken({ fetch: this.#fetch, now: this.#now, refreshToken }).pipe(Effect.result);
      if (Result.isFailure(tokens)) {
        const cause = tokens.failure.cause;
        if (cause instanceof LinkAuthError && cause.failure === "refresh_rejected") {
          yield* this.#serialize(() =>
            Effect.gen({ self: this }, function* () {
              if (generation !== this.#generation) return;
              const now = this.#now();
              yield* this.#store.write({
                ...record,
                accessTokenExpiresAt: Math.min(record.accessTokenExpiresAt ?? now, now),
                refreshToken: null,
              });
              this.#expired = true;
              this.#error = sourceText("error.connector.linkExpired");
            }),
          );
          this.#emitStatus();
        }
        return yield* tokens.failure;
      }
      registerTokenSecrets(tokens.success);
      const next: LinkAccountRecord = {
        ...record,
        ...tokens.success,
        refreshToken: tokens.success.refreshToken ?? record.refreshToken,
      };
      const committed = yield* this.#serialize(() =>
        Effect.gen({ self: this }, function* () {
          if (generation !== this.#generation) return false;
          yield* this.#store.write(next);
          return true;
        }),
      );
      if (!committed)
        return yield* new LinkOperationError({ cause: new Error(sourceText("error.connector.linkNotConnected")) });
      return next;
    });
    return yield* this.#refreshQueue.withPermit(work).pipe(Effect.uninterruptible);
  });

  readonly #finishSignIn = Effect.fn("LinkAccount.finishSignIn")(function* (
    this: LinkAccountService,
    pending: PendingSignIn,
    device: LinkDeviceCode,
  ): Effect.fn.Return<void> {
    const signIn = Effect.gen({ self: this }, function* () {
      const tokens = yield* pollLinkDeviceToken({
        device,
        fetch: this.#fetch,
        now: this.#now,
        signal: pending.controller.signal,
      });
      registerTokenSecrets(tokens);
      const email = yield* this.#readEmail(tokens.accessToken);
      const record: LinkAccountRecord = { ...tokens, email };
      const committed = yield* this.#serialize(() =>
        Effect.gen({ self: this }, function* () {
          if (this.#pending !== pending || this.#disposed) return false;
          yield* this.#store.write(record);
          this.#generation += 1;
          this.#pending = null;
          this.#expired = false;
          this.#error = null;
          return true;
        }),
      );
      if (committed) this.#emitStatus();
    });
    yield* signIn.pipe(
      Effect.catch(({ cause }) =>
        Effect.sync(() => {
          if (pending.controller.signal.aborted || this.#pending !== pending) return;
          this.#fail(pending, cause);
        }),
      ),
    );
  });

  readonly #readEmail = Effect.fn("LinkAccount.readEmail")(function* (this: LinkAccountService, accessToken: string) {
    const read = yield* this.#send("GET", "/userinfo", undefined, accessToken).pipe(Effect.result);
    if (Result.isFailure(read) || read.success.status !== 200) return null;
    const parsed = userInfoSchema.safeParse(read.success.data);
    return parsed.success ? (parsed.data.email ?? null) : null;
  });

  #fail(pending: PendingSignIn, error: unknown): void {
    pending.controller.abort();
    this.#pending = null;
    this.#error = redactText(error instanceof Error ? error.message : String(error));
    if (!(error instanceof LinkAuthError)) logger.warn("The Link sign-in failed.", { cause: toLogValue(error) });
    this.#emitStatus();
  }

  #state(): LinkAccountState {
    if (this.#pending) return "pending";
    if (!this.#store.read()) return "disconnected";
    return this.#expired ? "expired" : "connected";
  }

  #accessTokenExpired(record: LinkAccountRecord, margin = 0): boolean {
    return record.accessTokenExpiresAt !== null && record.accessTokenExpiresAt - margin <= this.#now();
  }

  #serialize<T>(change: () => Effect.Effect<T, LinkOperationError>): Effect.Effect<T, LinkOperationError> {
    return this.#queue.withPermit(Effect.suspend(change)).pipe(Effect.uninterruptible);
  }

  readonly #open = Effect.fn("LinkAccount.open")(function* (this: LinkAccountService, url: string) {
    yield* linkCall(() => this.#openExternal(url)).pipe(
      Effect.catch(({ cause }) =>
        Effect.sync(() => logger.warn("The Link page could not be opened.", { cause: toLogValue(cause) })),
      ),
    );
  });

  #emitStatus(): void {
    const status = this.status();
    for (const listener of this.#listeners) listener(status);
  }
}

function registerTokenSecrets(tokens: Pick<LinkTokenSet, "accessToken" | "refreshToken">): void {
  registerSecretValue(tokens.accessToken);
  if (tokens.refreshToken) registerSecretValue(tokens.refreshToken);
}

function parseAnswer<T>(
  schema: z.ZodType<T>,
  response: LinkResponse,
  what: string,
): Effect.Effect<T, LinkOperationError> {
  return linkDecode(() => {
    assertOk(response, what);
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) throw unexpected(what);
    return parsed.data;
  });
}

function isUnreachable(error: LinkOperationError): boolean {
  return error.cause instanceof LinkAuthError && error.cause.failure === "unreachable";
}

function assertOk(response: LinkResponse, what: string): void {
  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 401) throw new Error(sourceText("error.connector.linkExpired"));
  throw unexpected(`${what}: HTTP ${response.status}${apiMessage(response.data)}`);
}

function apiMessage(data: unknown): string {
  const parsed = z
    .object({ error: z.union([z.string(), z.object({ message: z.string().optional(), code: z.string().optional() })]) })
    .safeParse(data);
  if (!parsed.success) return "";
  const error = parsed.data.error;
  const message = typeof error === "string" ? error : (error.message ?? error.code);
  return message ? `, ${message}` : "";
}

function walletError(error: LinkOperationError): LinkWalletError {
  const cause = error.cause;
  return new LinkWalletError({ message: redactText(cause instanceof Error ? cause.message : String(cause)) });
}
