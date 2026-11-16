// The cards, contact info and API keys of the Vault, as agents use them. Each item is for every agent,
// or for the agents that the user chose; an agent sees, fills and changes only the items it can use. The main process implements
// this port with the encrypted Vault file. Agents read logins through the `PasswordVault` port instead
// (`list_logins` / `submit_secret`). Agents can add and change contacts, change the fields of a card
// that are not secret, and delete items. An agent can save a password, a two-step key or an API key that
// it has, such as one the user pasted in the chat or one a site showed in its two-step setup; it never
// reads one back. A card number gets in only from the
// form of `request_vault_item`, which the user fills in.

import type {
  VaultCardBrand,
  VaultContactFields,
  VaultItemKind,
  VaultItemOrigin,
  VaultSaveInput,
} from "@openbot/contracts/ipc";
import type { Effect } from "effect";
import type { PasswordVaultError } from "./password-vault";

/** What an agent may see of a login: never the password, the two-step key or the notes. */
interface VaultLoginForAgent extends VaultItemOrigin {
  id: string;
  website: string;
  username: string;
  /** Whether `submit_secret` with `method=authenticator` can enter a code for this login. */
  hasTwoStepKey: boolean;
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
 * value; in a new contact it is empty. A login changes its username and password, never its website,
 * so that its password stays bound to its website. A card changes only its fields that are not secret.
 */
export type VaultAgentChange =
  | { kind: "contact"; id?: string | undefined; fields: { [Key in keyof VaultContactFields]?: string | undefined } }
  | {
      kind: "login";
      id: string;
      username?: string | undefined;
      password?: string | undefined;
      /** A TOTP setup key or `otpauth://totp/` link. "" removes the saved key. */
      twoStepKey?: string | undefined;
    }
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

/** The agent that acts: its id selects the items that it can use, and its name is the `addedBy` of a new item. */
export interface VaultAgent {
  id: string;
  name: string | undefined;
}

/** An API key that an agent can read. `own` when the key is for this agent only. */
interface VaultAgentKey {
  name: string;
  value: string;
  own: boolean;
}

/**
 * An API key that an agent saves. The Vault has one key for each name for every agent, and one for
 * each name and agent; the agent's own key wins over the key for every agent.
 */
export interface VaultAgentApiKey {
  /** The environment variable name, such as OPENAI_API_KEY. */
  name: string;
  key: string;
  /** Replaces the saved notes when given. */
  notes?: string | undefined;
}

/** A new login, card or contact that the user typed into the form of `request_vault_item`. */
export type VaultEnteredItem = Exclude<VaultSaveInput, { kind: "apiKey" }> & { id: null };

export interface VaultItems {
  /** Whether the Vault can be read and changed now. It cannot without OS encryption or with a damaged file. */
  ready(): boolean;
  /**
   * The API keys that `agentId` can use, which `AgentApiKeys` writes to its files: for each name, the
   * key for chosen agents that names it, or else the key for every agent. None while the Vault is not ready.
   */
  apiKeys(agentId: string): VaultAgentKey[];
  /**
   * The API keys for every agent, not for chosen agents, which `AgentApiKeys` also writes to the shared
   * path of earlier versions. None while the Vault is not ready.
   */
  sharedApiKeys(): Omit<VaultAgentKey, "own">[];
  /** Whether a card that `agentId` can use is saved now. Agents are told about card fill only while one is. */
  hasCards(agentId: string): boolean;
  /** Whether contact info that `agentId` can use is saved now. */
  hasContacts(agentId: string): boolean;
  listForAgent(agentId: string): {
    logins: VaultLoginForAgent[];
    cards: VaultCardForAgent[];
    contacts: VaultContactForAgent[];
  };
  /** The values to type for `cardId`, or null when no such card is saved for `agentId`. */
  cardSecret(cardId: string, agentId: string): VaultCardSecret | null;
  /** Whether the owner let agents fill `cardId` on the HTTPS `page` into fields of each of `frames`. */
  cardFillApproved(cardId: string, page: string, frames: readonly string[]): boolean;
  /** Keeps the owner's approval to fill `cardId` on `page` into fields of `frames`. */
  approveCardFill(cardId: string, page: string, frames: readonly string[]): Effect.Effect<void, PasswordVaultError>;
  /** Adds or changes an item that the agent can use. A new item is for every agent, and keeps the agent's name. */
  save(
    change: VaultAgentChange,
    agent: VaultAgent,
  ): Effect.Effect<VaultAgentResult & { created: boolean }, PasswordVaultError>;
  /** Deletes an item that `agentId` can use. Null when it has no item with this id. */
  delete(id: string, agentId: string): Effect.Effect<VaultAgentResult | null, PasswordVaultError>;
  /**
   * Keeps a typed password. A saved login that the agent can use, for the same site and username, gets
   * the new password; `changed` is false when it had the same one. A new login is for every agent.
   */
  saveLogin(
    login: VaultTypedLogin,
    agent: VaultAgent,
  ): Effect.Effect<VaultAgentResult & { created: boolean; changed: boolean }, PasswordVaultError>;
  /**
   * Saves the API key for every agent, or for this agent only when `only`. The key replaces the saved
   * key of its name and scope. The agent also stops using every other key of the name for chosen
   * agents, so the new key is the one it reads; such a key that no agent then uses is deleted.
   */
  saveApiKey(
    apiKey: VaultAgentApiKey,
    agent: VaultAgent,
    only: boolean,
  ): Effect.Effect<VaultAgentResult & { created: boolean }, PasswordVaultError>;
  /** Deletes the API key of this name that is for `agentId` only. False when it has none. */
  removeAgentApiKey(agentId: string, name: string): Effect.Effect<boolean, PasswordVaultError>;
  /**
   * Adds an item that the user typed, for every agent. The values are checked as the Vault page checks
   * them; a wrong value fails with text that the user reads.
   */
  addEntered(item: VaultEnteredItem, agent: VaultAgent): Effect.Effect<VaultAgentResult, PasswordVaultError>;
}
