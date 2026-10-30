// The cards, contact info and API keys of the Vault, as agents use them. The main process implements
// this port with the encrypted Vault file. Agents read logins through the `PasswordVault` port instead
// (`list_logins` / `submit_secret`). Agents can add and change contacts, change the fields of a login
// or card that are not secret, and delete items; a password gets in only from the secure input.

import type { VaultCardBrand, VaultContactFields, VaultItemKind, VaultItemOrigin } from "@openbot/contracts/ipc";
import type { Effect } from "effect";
import type { PasswordVaultError } from "./password-vault";

/** What an agent may see of a login: never the password or the notes. */
interface VaultLoginForAgent extends VaultItemOrigin {
  id: string;
  website: string;
  username: string;
}

/** What an agent may see of a card. The number and the security code are never in it. */
interface VaultCardForAgent extends VaultItemOrigin {
  id: string;
  label: string;
  nameOnCard: string;
  brand: VaultCardBrand | null;
  last4: string;
  /** `MM/YYYY`. */
  expiry: string;
  /** Whether fill_card can type a security code. The code itself is never in it. */
  hasSecurityCode: boolean;
  billingContactId: string | null;
}

/** Contact info is not secret: an agent sees every field and types them itself. */
interface VaultContactForAgent extends VaultContactFields, VaultItemOrigin {
  id: string;
}

/** What the browser types for a card. It goes to the page only, never to an agent. */
export interface VaultCardSecret {
  number: string;
  securityCode: string;
  expMonth: number;
  expYear: number;
  nameOnCard: string;
}

/**
 * A change that an agent asks for. A contact without `id` is new. A field that is not given keeps its
 * value; in a new contact it is empty. A login changes only its username, so that its password stays
 * bound to its website. A card changes only its fields that are not secret.
 */
export type VaultAgentChange =
  | { kind: "contact"; id?: string | undefined; fields: { [Key in keyof VaultContactFields]?: string | undefined } }
  | { kind: "login"; id: string; username?: string | undefined }
  | {
      kind: "card";
      id: string;
      label?: string | undefined;
      nameOnCard?: string | undefined;
      expMonth?: number | undefined;
      expYear?: number | undefined;
      billingContactId?: string | null | undefined;
    };

/** What an agent and the chat learn of a change: never a secret. */
export interface VaultAgentResult {
  id: string;
  kind: VaultItemKind;
  /** The label, the site or the last four digits that the user knows the item by. */
  name: string;
}

/** A password that the user typed into the secure input and asked to keep. */
export interface VaultTypedLogin {
  /** The HTTPS origin of the sign-in page. */
  origin: string;
  username: string;
  password: string;
}

export interface VaultItems {
  /** Whether the Vault can be read and changed now. It cannot without OS encryption or with a damaged file. */
  ready(): boolean;
  /** The saved API keys, which `AgentApiKeys` writes to files. None while the Vault is not ready. */
  apiKeys(): { name: string; value: string }[];
  /** Whether a card is saved now. Agents are told about card fill only while one is. */
  hasCards(): boolean;
  /** Whether contact info is saved now. */
  hasContacts(): boolean;
  listForAgent(): { logins: VaultLoginForAgent[]; cards: VaultCardForAgent[]; contacts: VaultContactForAgent[] };
  /** The values to type for `cardId`, or null when no such card is saved. */
  cardSecret(cardId: string): VaultCardSecret | null;
  /** Whether the owner let agents fill `cardId` on the HTTPS `page` into fields of each of `frames`. */
  cardFillApproved(cardId: string, page: string, frames: readonly string[]): boolean;
  /** Keeps the owner's approval to fill `cardId` on `page` into fields of `frames`. */
  approveCardFill(cardId: string, page: string, frames: readonly string[]): Effect.Effect<void, PasswordVaultError>;
  /** Adds or changes an item. `addedBy` is the agent's name, if known; a new item keeps it. */
  save(
    change: VaultAgentChange,
    addedBy: string | undefined,
  ): Effect.Effect<VaultAgentResult & { created: boolean }, PasswordVaultError>;
  /** Deletes an item. Null when no item has this id. */
  delete(id: string): Effect.Effect<VaultAgentResult | null, PasswordVaultError>;
  /**
   * Keeps a typed password. A saved login for the same site and username gets the new password;
   * `changed` is false when it had the same one.
   */
  saveLogin(
    login: VaultTypedLogin,
    addedBy: string | undefined,
  ): Effect.Effect<VaultAgentResult & { created: boolean; changed: boolean }, PasswordVaultError>;
}
