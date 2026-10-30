import { randomUUID } from "node:crypto";
import type {
  StartWhatsAppLinkInput,
  WhatsAppAccount,
  WhatsAppGroupList,
  WhatsAppLinkState,
  WhatsAppSender,
} from "@openbot/contracts/ipc";
import { MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { newStoreKey } from "@openbot/whatsapp/auth-store";
import { Effect, Schema } from "effect";
import type { MessagingCredentials, MessagingOperationFailed } from "../messaging-service";
import type { MessagingStore } from "../messaging-store";
import { maskedNumber, whatsAppCredentials, whatsAppIdentity } from "./whatsapp-driver";
import { userJid } from "./whatsapp-events";
import type { WhatsAppConnectionHandle, WhatsAppPolicy, WhatsAppRuntime } from "./whatsapp-runtime";
import { WhatsAppPairingRequests, type WhatsAppSenderRules } from "./whatsapp-senders";

export class WhatsAppConnectFailed extends Schema.TaggedError<WhatsAppConnectFailed>()("WhatsAppConnectFailed", {
  cause: Schema.Defect(),
}) {}

/** How long a link waits for the phone. WhatsApp shows about six QR codes in that time. */
const LINK_TIMEOUT_MS = 3 * 60_000;

const IDLE: WhatsAppLinkState = { status: "idle", qr: null, code: null, workspaceId: null, error: null };

/** What the messaging service does for a link: makes the connection, and starts it with its values. */
export interface WhatsAppConnectHooks {
  /** The connection of the number, new or the one it had (which stops). Returns its id. */
  prepare(workspaceId: string, workspaceName: string): Effect.Effect<string, MessagingOperationFailed>;
  /** Saves the values of the connection and starts it. */
  finish(connectionId: string, values: Record<string, string>): Effect.Effect<void, MessagingOperationFailed>;
  /** Runs an operation in the service's scope; a failure is only logged. */
  dispatch(operation: Effect.Effect<void, MessagingOperationFailed>): void;
}

export interface WhatsAppConnectOptions {
  runtime: WhatsAppRuntime;
  store: MessagingStore;
  credentials: MessagingCredentials;
  hooks: WhatsAppConnectHooks;
}

interface RunningLink {
  storeId: string;
  handle: WhatsAppConnectionHandle;
  timer: ReturnType<typeof setTimeout>;
  unsubscribe: Array<() => void>;
  finishing: boolean;
}

/**
 * The WhatsApp half of the messaging service: the link of a new number, and who may give work through
 * each linked number. A link pairs a new device in a new store, which becomes the connection's store
 * when the link finishes; a failed link deletes it, so it leaves nothing. The sender settings live in `openbot.db` (allowed
 * senders) and in the connection's stored values (own number); pairing requests are in memory.
 */
export class WhatsAppConnect implements WhatsAppPolicy {
  readonly #runtime: WhatsAppRuntime;
  readonly #store: MessagingStore;
  readonly #credentials: MessagingCredentials;
  readonly #hooks: WhatsAppConnectHooks;
  readonly #requests = new WhatsAppPairingRequests();
  #link: RunningLink | null = null;
  #state: WhatsAppLinkState = IDLE;

  constructor(options: WhatsAppConnectOptions) {
    this.#runtime = options.runtime;
    this.#store = options.store;
    this.#credentials = options.credentials;
    this.#hooks = options.hooks;
    this.#runtime.setPolicy(this);
  }

  linkState(): WhatsAppLinkState {
    return this.#state;
  }

  /** Starts a link: a QR code to scan, or a pairing code for the given phone. An earlier link ends. */
  readonly startLink = Effect.fn("WhatsAppConnect.startLink")(function* (
    this: WhatsAppConnect,
    input: StartWhatsAppLinkInput,
  ) {
    yield* this.cancelLink();
    const storeId = `link-${randomUUID()}`;
    const key = newStoreKey();
    let handle: WhatsAppConnectionHandle;
    try {
      handle = this.#runtime.open(storeId, key, true);
    } catch {
      this.#state = { ...IDLE, status: "failed", error: "unavailable" };
      return this.#state;
    }
    const timer = setTimeout(() => this.#hooks.dispatch(this.#fail("timeout")), LINK_TIMEOUT_MS);
    timer.unref?.();
    const link: RunningLink = { storeId, handle, timer, unsubscribe: [], finishing: false };
    this.#link = link;
    this.#state = { ...IDLE, status: "waiting" };
    let codeRequested = false;
    link.unsubscribe.push(
      handle.session.onQr((qr) => {
        if (this.#link !== link) return;
        if (input.method === "qr") {
          this.#state = { ...this.#state, qr };
          return;
        }
        // A pairing code is asked once the socket is ready to show a QR code.
        if (codeRequested || !input.phoneNumber) return;
        codeRequested = true;
        this.#hooks.dispatch(
          handle.session.requestPairingCode(input.phoneNumber).pipe(
            Effect.flatMap((code) =>
              Effect.sync(() => {
                if (this.#link === link)
                  this.#state = { ...this.#state, code: code.replace(/[^A-Z0-9]/giu, "").toUpperCase() };
              }),
            ),
            Effect.catch(() => this.#fail("refused")),
          ),
        );
      }),
      handle.session.onState((state) => {
        if (this.#link !== link) return;
        if (state === "open" && handle.store.linked) this.#hooks.dispatch(this.#finish(link, key, input.ownNumber));
        else if (state === "logged_out" || state === "replaced") this.#hooks.dispatch(this.#fail("refused"));
        else if (state === "unreachable") this.#hooks.dispatch(this.#fail("unavailable"));
        else if (state === "stopped" && !link.finishing) this.#hooks.dispatch(this.#fail("timeout"));
      }),
    );
    handle.session.start();
    return this.#state;
  });

  readonly cancelLink = Effect.fn("WhatsAppConnect.cancelLink")(function* (this: WhatsAppConnect) {
    const link = this.#link;
    if (!link || link.finishing) return;
    yield* this.#end(link, true);
    this.#state = IDLE;
  });

  // The sender policy, read by the transport for each message.

  rules(workspaceId: string): WhatsAppSenderRules {
    const record = this.#store.connectionForWorkspace("whatsapp", workspaceId);
    if (!record) return { ownNumber: true, contacts: new Set(), groups: new Set() };
    const senders = this.#store.allowedSenders(record.connectionId);
    return {
      ownNumber: this.#ownNumber(record.connectionId),
      contacts: new Set(senders.filter((sender) => sender.kind === "contact").map((sender) => sender.id)),
      groups: new Set(senders.filter((sender) => sender.kind === "group").map((sender) => sender.id)),
    };
  }

  pairing(workspaceId: string, senderId: string, name: string): { code: string; created: boolean } | null {
    const record = this.#store.connectionForWorkspace("whatsapp", workspaceId);
    if (!record?.enabled || this.#ownNumber(record.connectionId)) return null;
    return this.#requests.request(workspaceId, senderId, name);
  }

  /** The settings of each linked number, for the overview. */
  accounts(): WhatsAppAccount[] {
    return this.#store
      .connections()
      .filter((record) => record.platform === "whatsapp" && this.#credentials.status(record.connectionId) !== "missing")
      .map((record) => ({
        workspaceId: record.workspaceId,
        ownNumber: this.#ownNumber(record.connectionId),
        allowedSenders: this.#store.allowedSenders(record.connectionId).slice(0, MESSAGING_LIMITS.allowedSenders),
        pendingRequests: this.#requests.list(record.workspaceId),
      }));
  }

  readonly addSender = Effect.fn("WhatsAppConnect.addSender")(function* (
    this: WhatsAppConnect,
    workspaceId: string,
    sender: WhatsAppSender,
  ) {
    const connectionId = yield* this.#connectionId(workspaceId);
    if (this.#store.allowedSenders(connectionId).length >= MESSAGING_LIMITS.allowedSenders)
      return yield* failure("error.messaging.whatsappTooManySenders");
    this.#store.addAllowedSender(connectionId, sender);
  });

  readonly removeSender = Effect.fn("WhatsAppConnect.removeSender")(function* (
    this: WhatsAppConnect,
    workspaceId: string,
    senderId: string,
  ) {
    const connectionId = yield* this.#connectionId(workspaceId);
    this.#store.removeAllowedSender(connectionId, senderId);
  });

  /** Approves a person, who then gets one line in WhatsApp, or ends the request without an answer. */
  readonly answerRequest = Effect.fn("WhatsAppConnect.answerRequest")(function* (
    this: WhatsAppConnect,
    workspaceId: string,
    code: string,
    approve: boolean,
  ) {
    const connectionId = yield* this.#connectionId(workspaceId);
    const request = this.#requests.take(workspaceId, code);
    if (!request) return yield* failure("error.messaging.whatsappRequestEnded");
    if (!approve) return;
    yield* this.addSender(workspaceId, { id: request.senderId, kind: "contact", name: request.name });
    const handle = this.#handle(connectionId);
    if (handle)
      yield* handle.session
        .send(userJid(request.senderId), { text: sourceText("status.messaging.whatsappPairingApproved") })
        .pipe(Effect.catch(() => Effect.void));
  });

  readonly setOwnNumber = Effect.fn("WhatsAppConnect.setOwnNumber")(function* (
    this: WhatsAppConnect,
    workspaceId: string,
    ownNumber: boolean,
  ) {
    const connectionId = yield* this.#connectionId(workspaceId);
    const values = this.#credentials.get(connectionId);
    if (!values) return yield* failure("error.messaging.whatsappNotConnected");
    yield* this.#credentials.set(connectionId, { ...values, ownNumber: ownNumber ? "1" : "0" });
    // An owner's personal number answers nobody it does not know.
    if (ownNumber) this.#requests.clear(workspaceId);
  });

  readonly groups = Effect.fn("WhatsAppConnect.groups")(function* (this: WhatsAppConnect, workspaceId: string) {
    const connectionId = yield* this.#connectionId(workspaceId);
    const handle = this.#handle(connectionId);
    if (!handle?.session.socket()) return yield* failure("error.messaging.whatsappNotConnected");
    const groups = yield* handle.session
      .groups()
      .pipe(Effect.mapError(() => failureError("error.messaging.whatsappNotConnected")));
    for (const group of groups) handle.chats.rememberGroup(group.id, group.subject);
    const list: WhatsAppGroupList = {
      groups: groups
        .map((group) => ({ id: group.id, name: (group.subject?.trim() || group.id).slice(0, MESSAGING_LIMITS.name) }))
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, MESSAGING_LIMITS.groups),
    };
    return list;
  });

  /** Forgets the requests of a number that was disconnected. */
  forget(workspaceId: string): void {
    this.#requests.clear(workspaceId);
  }

  /** The device is linked: its store becomes the connection's, and the connection starts. */
  readonly #finish = Effect.fn("WhatsAppConnect.finish")(function* (
    this: WhatsAppConnect,
    link: RunningLink,
    key: Uint8Array,
    ownNumber: boolean,
  ) {
    if (link.finishing || this.#link !== link) return;
    link.finishing = true;
    const identity = whatsAppIdentity(link.handle);
    if (!identity) return yield* this.#fail("refused");
    const name = link.handle.store.creds.me?.name?.trim();
    const workspaceName = name ? `${name} (${maskedNumber(identity.number)})` : maskedNumber(identity.number);
    yield* this.#end(link, false);
    const connectionId = yield* this.#hooks.prepare(identity.number, workspaceName);
    // The number's earlier device was replaced by this link, so its keys go.
    const previous = this.#credentials.get(connectionId)?.storeId;
    if (previous && previous !== link.storeId) this.#runtime.delete(previous);
    this.#runtime.promote(link.storeId);
    yield* this.#hooks.finish(connectionId, {
      whatsappStoreKey: Buffer.from(key).toString("base64"),
      storeId: link.storeId,
      ownNumber: ownNumber ? "1" : "0",
    });
    this.#state = { ...IDLE, status: "linked", workspaceId: identity.number };
  });

  #fail(error: NonNullable<WhatsAppLinkState["error"]>): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const link = this.#link;
      if (!link) return;
      yield* this.#end(link, true);
      this.#state = { ...IDLE, status: "failed", error };
    });
  }

  /** Stops the link's socket; a failed link also deletes its store. A finished one keeps it open. */
  #end(link: RunningLink, discard: boolean): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.#link === link) this.#link = null;
      clearTimeout(link.timer);
      for (const unsubscribe of link.unsubscribe.splice(0)) unsubscribe();
      yield* link.handle.session.stop();
      if (discard) this.#runtime.delete(link.storeId);
    });
  }

  /** The open store of a connection, by the store id in its values. */
  #handle(connectionId: string): WhatsAppConnectionHandle | null {
    const storeId = this.#credentials.get(connectionId)?.storeId;
    return storeId ? this.#runtime.get(storeId) : null;
  }

  #ownNumber(connectionId: string): boolean {
    const values = this.#credentials.get(connectionId);
    return values ? whatsAppCredentials(values).ownNumber : true;
  }

  #connectionId(workspaceId: string): Effect.Effect<string, WhatsAppConnectFailed> {
    const record = this.#store.connectionForWorkspace("whatsapp", workspaceId);
    return record && this.#credentials.status(record.connectionId) !== "missing"
      ? Effect.succeed(record.connectionId)
      : failure("error.messaging.whatsappNotConnected");
  }
}

type WhatsAppErrorKey =
  | "error.messaging.whatsappNotConnected"
  | "error.messaging.whatsappTooManySenders"
  | "error.messaging.whatsappRequestEnded";

function failureError(key: WhatsAppErrorKey): WhatsAppConnectFailed {
  return new WhatsAppConnectFailed({ cause: new Error(sourceText(key)) });
}

function failure(key: WhatsAppErrorKey): Effect.Effect<never, WhatsAppConnectFailed> {
  return Effect.fail(failureError(key));
}
