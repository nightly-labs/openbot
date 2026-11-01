// One sign-in to the user's Telegram account, as a state machine that the connector service drives.
//
// Telegram signs a user in with a QR code (scanned in Telegram on the phone: Settings > Devices >
// Link Desktop Device), or with the phone number, the code that Telegram sends, and the two-step
// password when the account has one. GramJS asks for each value through a callback; each callback
// here waits until the user submits that value.
//
// Every run has a generation number. A new start or a cancel bumps it and ends the run's client, so
// nothing from an abandoned run can finish later. Once Telegram has accepted a sign-in, the run takes
// the client out of its own hands and commits it (reads the account, saves the session) as one
// uninterruptible step that start and cancel wait for. A cancel or a sign-out that arrives in the
// middle can then neither end the client being handed over nor be undone by a late save.

import { sourceText } from "@openbot/i18n/source";
import { redactText, registerSecretValue } from "@openbot/logging";
import { Deferred, Effect, Result, type Scope, Semaphore } from "effect";
import type { TelegramPhoneSignInParams, TelegramQrSignInParams } from "./telegram-account-client";
import type { TelegramAccountRecordAccount } from "./telegram-account-connector-store";
import { TelegramAccountOperationError, telegramErrorMessage } from "./telegram-account-effects";

export type TelegramSignInMethod = "qr" | "phone";
export type TelegramSignInField = "phone" | "code" | "password";
export type TelegramSignInStep = "starting" | TelegramSignInField | "qr" | "done" | "failed" | "cancelled";

export interface TelegramSignInState {
  step: TelegramSignInStep;
  method: TelegramSignInMethod;
  /** True while OpenBot talks to Telegram between two steps. */
  busy: boolean;
  qrUrl: string | null;
  qrExpiresAt: number | null;
  codeViaApp: boolean | null;
  passwordHint: string | null;
  /** The sentence for the user, from `sourceText`. */
  error: string | null;
  /** Telegram's own reason for a failed sign-in, such as `API_ID_INVALID`. Never shown. */
  reason: string | null;
}

/** The part of a Telegram client that a sign-in needs. */
export interface TelegramAuthClient {
  connect(): Effect.Effect<void, TelegramAccountOperationError>;
  signInWithQrCode(params: TelegramQrSignInParams): Effect.Effect<void, TelegramAccountOperationError>;
  signInWithPhone(params: TelegramPhoneSignInParams): Effect.Effect<void, TelegramAccountOperationError>;
  account(): Effect.Effect<TelegramAccountRecordAccount, TelegramAccountOperationError>;
  exportSession(): string;
  /** Ends the authorization at Telegram, so it leaves Settings > Devices. */
  logOut(): Effect.Effect<void, TelegramAccountOperationError>;
  destroy(): Effect.Effect<void>;
}

export interface TelegramSignInOptions<C extends TelegramAuthClient> {
  /** A new client with no session. It can load GramJS, so it is an Effect. */
  createClient: () => Effect.Effect<C, TelegramAccountOperationError>;
  /** Saves the session and starts to use the client. A failure leaves the user signed out. */
  onSuccess: (
    client: C,
    session: string,
    account: TelegramAccountRecordAccount,
  ) => Effect.Effect<void, TelegramAccountOperationError>;
  onChange: (state: TelegramSignInState) => void;
  /** Owns the runs. Closing it stops a run that waits for the user. */
  scope: Scope.Scope;
}

interface PendingInput {
  field: TelegramSignInField;
  generation: number;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

/** The reason of a run that a newer start or a cancel ended. */
const ATTEMPT_ENDED = "SIGN_IN_ATTEMPT_ENDED";
/** The reason when Telegram asks for a name, which means that the number has no account. */
const SIGN_UP_REFUSED = "SIGN_UP_REFUSED";

class SignInEnded extends Error {
  constructor() {
    super(ATTEMPT_ENDED);
  }
}

const IDLE_LIMIT_MS = 10 * 60 * 1000;

/** The sentence for an error after which Telegram asks for the same value again, or null. */
function retryMessage(reason: string): string | null {
  switch (reason) {
    case "PHONE_CODE_INVALID":
      return sourceText("error.connector.telegramAccountCodeInvalid");
    case "PHONE_CODE_EMPTY":
    case "Code is empty":
      return sourceText("error.connector.telegramAccountCodeEmpty");
    case "PASSWORD_HASH_INVALID":
      return sourceText("error.connector.telegramAccountPasswordInvalid");
    case "Password is empty":
      return sourceText("error.connector.telegramAccountPasswordEmpty");
    case "PHONE_NUMBER_INVALID":
      return sourceText("error.connector.telegramAccountPhoneInvalid");
    default:
      return null;
  }
}

/** The sentence for an error that ends the attempt. */
function finalMessage(reason: string): string {
  if (reason === SIGN_UP_REFUSED || reason === "PHONE_NUMBER_UNOCCUPIED")
    return sourceText("error.connector.telegramAccountNoAccount");
  if (reason === "PHONE_CODE_EXPIRED") return sourceText("error.connector.telegramAccountCodeExpired");
  if (reason === "PHONE_NUMBER_BANNED") return sourceText("error.connector.telegramAccountPhoneBanned");
  if (reason === "AUTH_TOKEN_EXPIRED") return sourceText("error.connector.telegramAccountQrExpired");
  if (reason === "SESSION_PASSWORD_NEEDED") return sourceText("error.connector.telegramAccountPasswordNeeded");
  if (reason === "API_ID_INVALID" || reason === "API_ID_PUBLISHED_FLOOD")
    return sourceText("error.connector.telegramAccountApiRejected");
  const flood = /^FLOOD_WAIT_(\d+)$/u.exec(reason) ?? /wait of (\d+) seconds/iu.exec(reason);
  if (flood?.[1])
    return sourceText("error.connector.telegramAccountFloodWait", { count: Math.ceil(Number(flood[1]) / 60) });
  if (reason === "AUTH_USER_CANCEL" || reason === ATTEMPT_ENDED)
    return sourceText("error.connector.telegramAccountCancelled");
  return sourceText("error.connector.telegramAccountRefused", { detail: redactText(reason) });
}

/** Whether `reason` means that Telegram does not accept the api_id and api_hash. */
export function telegramCredentialsRejected(reason: string | null): boolean {
  return reason === "API_ID_INVALID" || reason === "API_ID_PUBLISHED_FLOOD";
}

export class TelegramSignIn<C extends TelegramAuthClient> {
  readonly #options: TelegramSignInOptions<C>;
  #state: TelegramSignInState;
  #generation = 0;
  #client: C | null = null;
  #pending: PendingInput | null = null;
  /** The sentence and reason that `onError` kept, for the failure GramJS throws after it. */
  #finalError: { message: string; reason: string } | null = null;
  /** Set once Telegram asked for the password in this run; a later QR code is stale. */
  #passwordAsked = false;
  /** The commit of a signed-in client, while it runs. Start and cancel wait for it. */
  #committing: Deferred.Deferred<void> | null = null;
  /** Start and cancel run one at a time, so the user and a joined server cannot interleave them. */
  readonly #queue = Semaphore.makeUnsafe(1);
  #idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TelegramSignInOptions<C>) {
    this.#options = options;
    this.#state = {
      step: "starting",
      method: "qr",
      busy: true,
      qrUrl: null,
      qrExpiresAt: null,
      codeViaApp: null,
      passwordHint: null,
      error: null,
      reason: null,
    };
  }

  get state(): TelegramSignInState {
    return this.#state;
  }

  /** Whether the attempt has ended, signed in or not. */
  get ended(): boolean {
    return this.#state.step === "done" || this.#state.step === "failed" || this.#state.step === "cancelled";
  }

  /**
   * Waits for a sign-in that Telegram has accepted to be saved. A change that replaces the stored
   * record waits for this first, so it cannot overwrite a session that is being saved.
   */
  settled(): Effect.Effect<void> {
    return Effect.suspend(() => (this.#committing ? Deferred.await(this.#committing) : Effect.void));
  }

  /** Starts, or starts again with another method. Ends the run that was going. */
  start(method: TelegramSignInMethod): Effect.Effect<void> {
    return this.#serialize(
      Effect.gen({ self: this }, function* () {
        if (this.#committing) yield* Deferred.await(this.#committing);
        if (this.#state.step === "done") return;
        const generation = ++this.#generation;
        this.#rejectPending();
        this.#update({
          step: "starting",
          method,
          busy: true,
          qrUrl: null,
          qrExpiresAt: null,
          codeViaApp: null,
          passwordHint: null,
          error: null,
          reason: null,
        });
        // Not awaited: the run lasts until the user finishes.
        yield* Effect.forkIn(this.#run(method, generation), this.#options.scope);
      }),
    );
  }

  /**
   * Answers the value that the current step asks for. A value in the wrong shape, or for a step that
   * has passed, sets the error and keeps the step.
   */
  submit(field: TelegramSignInField, value: string): void {
    if (field === "phone") {
      const cleaned = value.replace(/[\s\-().]/gu, "");
      if (!/^\+?\d{6,16}$/u.test(cleaned)) {
        this.#update({ error: sourceText("error.connector.telegramAccountPhoneFormat") });
        return;
      }
      const phone = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
      registerSecretValue(phone);
      this.#answer("phone", phone);
      return;
    }
    if (field === "code") {
      const cleaned = value.replace(/\s/gu, "");
      if (!/^[0-9A-Za-z-]{3,12}$/u.test(cleaned)) {
        this.#update({ error: sourceText("error.connector.telegramAccountCodeEmpty") });
        return;
      }
      registerSecretValue(cleaned, { allowShort: true });
      this.#answer("code", cleaned);
      return;
    }
    if (!value) {
      this.#update({ error: sourceText("error.connector.telegramAccountPasswordEmpty") });
      return;
    }
    registerSecretValue(value, { allowShort: true });
    this.#answer("password", value);
  }

  /**
   * Ends the attempt with `error` as the reason, or none. When Telegram has already accepted the
   * sign-in and the session is being saved, this waits for that and leaves the user signed in; the
   * caller can then sign out.
   */
  cancel(error: string | null = null): Effect.Effect<void> {
    return this.#serialize(
      Effect.gen({ self: this }, function* () {
        if (this.#committing) yield* Deferred.await(this.#committing);
        if (this.ended) return;
        this.#generation += 1;
        this.#rejectPending();
        yield* this.#endClient();
        this.#clearIdle();
        this.#update({ step: "cancelled", busy: false, qrUrl: null, qrExpiresAt: null, error, reason: null });
      }),
    );
  }

  // --- the run ---------------------------------------------------------------------------------

  readonly #run = Effect.fn("TelegramSignIn.run")(function* (
    this: TelegramSignIn<C>,
    method: TelegramSignInMethod,
    generation: number,
  ): Effect.fn.Return<void> {
    yield* this.#endClient();
    if (generation !== this.#generation) return;
    const created = yield* Effect.result(this.#options.createClient());
    if (Result.isFailure(created)) {
      if (generation === this.#generation) yield* this.#fail(created.failure.cause);
      return;
    }
    const client = created.success;
    if (generation !== this.#generation) {
      yield* client.destroy();
      return;
    }
    this.#client = client;
    this.#finalError = null;
    this.#passwordAsked = false;
    this.#touch();

    const password = (hint?: string) => {
      this.#passwordAsked = true;
      return this.#ask(generation, "password", { passwordHint: hint || null });
    };
    const onError = (error: Error) => Promise.resolve(this.#onError(generation, error));
    const attempt = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        yield* client.connect();
        yield* this.#assertCurrent(generation);
        if (method === "qr") {
          yield* client.signInWithQrCode({ qrCode: (code) => this.#showQr(generation, code), password, onError });
        } else {
          yield* client.signInWithPhone({
            phoneNumber: () => this.#ask(generation, "phone", {}),
            phoneCode: (viaApp) => this.#ask(generation, "code", { codeViaApp: viaApp ?? null }),
            password,
            // Telegram asks for a name only to create an account. OpenBot never creates one.
            firstAndLastNames: () => Promise.reject(new Error(SIGN_UP_REFUSED)),
            onError,
          });
        }
      }),
    );
    // Checked and handed over with no step between them, so a cancel sees either a run it can end
    // or a commit it must wait for.
    if (generation !== this.#generation) return;
    if (Result.isFailure(attempt)) {
      yield* this.#fail(attempt.failure.cause);
      return;
    }
    this.#client = null;
    this.#clearIdle();
    const commit = Deferred.makeUnsafe<void>();
    this.#committing = commit;
    this.#update({ busy: true, error: null });
    yield* this.#commit(client).pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          if (this.#committing === commit) this.#committing = null;
          yield* Deferred.succeed(commit, undefined);
        }),
      ),
      Effect.uninterruptible,
    );
  });

  readonly #commit = Effect.fn("TelegramSignIn.commit")(function* (
    this: TelegramSignIn<C>,
    client: C,
  ): Effect.fn.Return<void> {
    const saved = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        const account = yield* client.account();
        const session = client.exportSession();
        registerSecretValue(session);
        yield* this.#options.onSuccess(client, session, account);
      }),
    );
    if (Result.isFailure(saved)) {
      // Telegram already accepted the sign-in. Without a saved session nobody can end it later, so
      // it is ended at Telegram now, as far as Telegram answers.
      yield* client.logOut().pipe(Effect.ignore);
      yield* client.destroy();
      this.#update({
        step: "failed",
        busy: false,
        qrUrl: null,
        qrExpiresAt: null,
        error: sourceText("error.connector.telegramAccountSaveFailed", {
          detail: redactText(telegramErrorMessage(saved.failure.cause)),
        }),
        reason: telegramErrorMessage(saved.failure.cause),
      });
      return;
    }
    this.#update({ step: "done", busy: false, qrUrl: null, qrExpiresAt: null, error: null, reason: null });
  });

  #fail(cause: unknown): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const reason = this.#finalError?.reason ?? telegramErrorMessage(cause);
      const message = this.#finalError?.message ?? finalMessage(reason);
      yield* this.#endClient();
      this.#clearIdle();
      this.#update({ step: "failed", busy: false, qrUrl: null, qrExpiresAt: null, error: message, reason });
    });
  }

  #showQr(generation: number, code: { token: Buffer; expires: number }): Promise<void> {
    if (generation !== this.#generation) return Promise.reject(new SignInEnded());
    // GramJS can refresh the code once more after a scan; the password step must stay.
    if (this.#passwordAsked) return Promise.resolve();
    this.#update({
      step: "qr",
      busy: false,
      qrUrl: `tg://login?token=${code.token.toString("base64url")}`,
      qrExpiresAt: code.expires * 1000,
    });
    return Promise.resolve();
  }

  #ask(generation: number, field: TelegramSignInField, extra: Partial<TelegramSignInState>): Promise<string> {
    if (generation !== this.#generation) return Promise.reject(new SignInEnded());
    this.#rejectPending();
    // An error that the previous answer set stays beside the new question.
    this.#update({ ...extra, step: field, busy: false, qrUrl: null, qrExpiresAt: null });
    return new Promise<string>((resolve, reject) => {
      this.#pending = { field, generation, resolve, reject };
    });
  }

  #answer(field: TelegramSignInField, value: string): void {
    const pending = this.#pending;
    if (!pending || pending.field !== field || pending.generation !== this.#generation) {
      this.#update({ error: sourceText("error.connector.telegramAccountMovedOn") });
      return;
    }
    this.#pending = null;
    this.#touch();
    this.#update({ busy: true, error: null });
    pending.resolve(value);
  }

  #onError(generation: number, error: Error): boolean {
    if (generation !== this.#generation) return true;
    const reason = telegramErrorMessage(error);
    if (reason === ATTEMPT_ENDED) return true;
    const retry = retryMessage(reason);
    if (retry) {
      this.#update({ error: retry, busy: false });
      return false;
    }
    // GramJS then throws a generic AUTH_USER_CANCEL; the reason is kept for the final state.
    this.#finalError = { message: finalMessage(reason), reason };
    return true;
  }

  // --- helpers ---------------------------------------------------------------------------------

  #serialize(change: Effect.Effect<void>): Effect.Effect<void> {
    return this.#queue.withPermit(change);
  }

  #assertCurrent(generation: number): Effect.Effect<void, TelegramAccountOperationError> {
    return Effect.suspend(() =>
      generation === this.#generation
        ? Effect.void
        : Effect.fail(new TelegramAccountOperationError({ cause: new SignInEnded() })),
    );
  }

  #rejectPending(): void {
    const pending = this.#pending;
    this.#pending = null;
    pending?.reject(new SignInEnded());
  }

  #endClient(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const client = this.#client;
      this.#client = null;
      return client ? client.destroy() : Effect.void;
    });
  }

  #touch(): void {
    this.#clearIdle();
    this.#idleTimer = setTimeout(() => {
      void Effect.runPromise(this.cancel(sourceText("error.connector.telegramAccountTimedOut")));
    }, IDLE_LIMIT_MS);
    this.#idleTimer.unref();
  }

  #clearIdle(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  #update(patch: Partial<TelegramSignInState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#options.onChange(this.#state);
  }

  /** Ends the run without a new state, for the service's dispose. A commit in progress finishes. */
  dispose(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.#committing) yield* Deferred.await(this.#committing);
      this.#generation += 1;
      this.#rejectPending();
      this.#clearIdle();
      yield* this.#endClient();
    });
  }
}
