import { randomInt } from "node:crypto";
import { MESSAGING_LIMITS, type WhatsAppPairingRequest } from "@openbot/contracts/ipc";

const PAIRING_REQUEST_TTL_MS = 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface WhatsAppSenderRules {
  ownNumber: boolean;
  contacts: ReadonlyMap<string, string>;
  groups: ReadonlySet<string>;
}

export type SenderDecision = { type: "allow" } | { type: "pair" } | { type: "save" } | { type: "ignore" };

export interface SenderFacts {
  isGroup: boolean;
  chatJid: string;
  authorNumber: string | null;
  isSelfChat: boolean;
  fromMe: boolean;
}

export function senderDecision(rules: WhatsAppSenderRules, facts: SenderFacts): SenderDecision {
  if (facts.isSelfChat) return { type: "allow" };
  const allowedGroup = facts.isGroup && rules.groups.has(facts.chatJid);
  if (facts.fromMe) return allowedGroup ? { type: "save" } : { type: "ignore" };
  if (facts.isGroup) return allowedGroup ? { type: "allow" } : { type: "ignore" };
  if (facts.authorNumber && allowsContact(rules, facts.authorNumber)) return { type: "allow" };
  if (rules.ownNumber || !facts.authorNumber) return { type: "ignore" };
  return { type: "pair" };
}

export function whatsAppNumberForms(number: string): string[] {
  const brazil = /^55([1-9]{2})(9?)([6-9][0-9]{7})$/u.exec(number);
  if (!brazil) return [number];
  const [, area, nine, local] = brazil;
  return [number, nine ? `55${area}${local}` : `55${area}9${local}`];
}

export function allowsContact(rules: WhatsAppSenderRules, number: string): boolean {
  return whatsAppNumberForms(number).some((form) => rules.contacts.has(form));
}

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
