import { randomInt } from "node:crypto";
import { MESSAGING_LIMITS, type WhatsAppPairingRequest } from "@openbot/contracts/ipc";

/** How long a pairing request waits for the owner. */
const PAIRING_REQUEST_TTL_MS = 60 * 60 * 1000;
/** No 0/O or 1/I, so a code read aloud is not mistaken. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Who may give work through one linked number, read from the connection's settings for each message. */
export interface WhatsAppSenderRules {
  /** The owner's personal number: only their own chat and the allowed senders count. */
  ownNumber: boolean;
  /** Phone numbers in digits. */
  contacts: ReadonlySet<string>;
  /** Group JIDs. */
  groups: ReadonlySet<string>;
}

/** What one inbound message may do, before anything shows that it was seen. */
export type SenderDecision =
  | { type: "allow" }
  /** A dedicated number answers an unknown person once, with a code for the owner. */
  | { type: "pair" }
  | { type: "ignore" };

export interface SenderFacts {
  isGroup: boolean;
  chatJid: string;
  /** The author's phone number in digits, when it is known. A LID-only author has none. */
  authorNumber: string | null;
  /** The owner wrote it in their own "Message yourself" chat. */
  isSelfChat: boolean;
  /** The owner wrote it from this number, in any chat. */
  fromMe: boolean;
}

/**
 * The OpenClaw sender model. The owner's own chat always counts. An allowed group counts (the
 * transport still needs a mention or a reply in it). An allowed contact counts in a direct chat. On a
 * dedicated number an unknown direct sender gets one pairing code; on the owner's own number nobody
 * else is ever answered, so OpenBot never writes to the owner's contacts by itself.
 */
export function senderDecision(rules: WhatsAppSenderRules, facts: SenderFacts): SenderDecision {
  if (facts.isSelfChat) return { type: "allow" };
  // The owner's own messages in other chats are their personal conversations.
  if (facts.fromMe) return { type: "ignore" };
  if (facts.isGroup) return rules.groups.has(facts.chatJid) ? { type: "allow" } : { type: "ignore" };
  if (facts.authorNumber && rules.contacts.has(facts.authorNumber)) return { type: "allow" };
  if (rules.ownNumber || !facts.authorNumber) return { type: "ignore" };
  return { type: "pair" };
}

/**
 * The pairing requests of every linked number, in memory only. A request ends after an hour, when the
 * owner answers it, or at a restart; the person can write again for a new code. At most three wait
 * for each number, so a flood of strangers cannot fill the owner's list.
 */
export class WhatsAppPairingRequests {
  readonly #requests = new Map<string, WhatsAppPairingRequest[]>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  list(workspaceId: string): WhatsAppPairingRequest[] {
    const now = this.#now();
    const live = (this.#requests.get(workspaceId) ?? []).filter((request) => Date.parse(request.expiresAt) > now);
    this.#requests.set(workspaceId, live);
    return live;
  }

  /**
   * The code for this person: the one they already have, or a new one. Null when three others wait,
   * so the person gets no answer.
   */
  request(workspaceId: string, senderId: string, name: string): { code: string; created: boolean } | null {
    const live = this.list(workspaceId);
    const existing = live.find((request) => request.senderId === senderId);
    if (existing) return { code: existing.code, created: false };
    if (live.length >= MESSAGING_LIMITS.pendingRequests) return null;
    const request: WhatsAppPairingRequest = {
      code: newCode(),
      senderId,
      name: name.slice(0, MESSAGING_LIMITS.name) || senderId,
      expiresAt: new Date(this.#now() + PAIRING_REQUEST_TTL_MS).toISOString(),
    };
    this.#requests.set(workspaceId, [...live, request]);
    return { code: request.code, created: true };
  }

  /** Removes the request of the code and returns it, or null when it ended. */
  take(workspaceId: string, code: string): WhatsAppPairingRequest | null {
    const live = this.list(workspaceId);
    const found = live.find((request) => request.code === code) ?? null;
    if (found)
      this.#requests.set(
        workspaceId,
        live.filter((request) => request !== found),
      );
    return found;
  }

  clear(workspaceId: string): void {
    this.#requests.delete(workspaceId);
  }
}

function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}
